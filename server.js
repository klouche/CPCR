require('dotenv').config();
const cors = require('cors');
const express = require('express');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const acronyms = require('./acronym.json');
const { normalizeTextField } = require('./utils/text.js');
const fs = require('fs');
const path = require('path');
const { prisma } = require('./db');

// or ESM
// import { prisma } from './db.js';

// Resolve a safe log path for both local dev and Render
const DEFAULT_LOG_DIR = process.env.LOG_DIR || (process.env.RENDER ? '/var/data' : path.join(__dirname, 'data'));
const LOG_FILE = process.env.LOG_FILE || path.join(DEFAULT_LOG_DIR, 'requests-log.json');

// Ensure parent directory exists
const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error('⚠️ Failed to create log directory:', dir, e.message);
  }
};
ensureDir(path.dirname(LOG_FILE));

// Make sure log file exists
try {
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '[]'); // initialize empty JSON array
  }
} catch (e) {
  console.error('⚠️ Failed to initialize log file:', LOG_FILE, e.message);
}
console.log('📝 Logging to:', LOG_FILE);

function getClientIp(req) {
  let ip = req.ip || '';
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  return ip;
}

function logRequest(req, resBody) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      ip: getClientIp(req),
      query: req.body?.query,
      result: resBody
    };

    let logs = [];
    try {
      const raw = fs.readFileSync(LOG_FILE, 'utf-8');
      logs = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(logs)) logs = [];
    } catch (_) {
      logs = [];
    }

    logs.push(entry);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error('⚠️ logRequest failed:', e.message);
  }
}


// In-memory overlay for recently updated services to defeat eventual consistency
const recentUpdates = new Map(); // id -> { metadata, updatedAt }

const app = express();
const allowedOrigins = ['http://localhost:3000', 'https://swissbiobanking.ch'];

app.set('trust proxy', true);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));
app.use(express.json());

function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.Index(process.env.PINECONE_INDEX);
const orgIndex = pinecone.Index("infrastructure-index");
console.log("🔧 Using Pinecone index:", process.env.PINECONE_INDEX);

// --- Acronym helpers ---
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a unique list of aliases (acronyms and expansions) detected in the given fields.
 * The file ./acronym.json must map acronym => [expansions...]
 */
function buildAliasesForFields({ name, organization, hidden, description }) {
  const haystack = [name, organization, hidden, description]
    .filter(Boolean)
    .map(s => String(s))
    .join('\n');

  const aliasesSet = new Set();

  for (const [acro, expansions] of Object.entries(acronyms || {})) {
    const acroRegex = new RegExp(`\\b${escapeRegExp(acro)}\\b`, 'i');
    const hasAcro = acroRegex.test(haystack);

    const hasExpansion = Array.isArray(expansions) && expansions.some(exp => {
      const re = new RegExp(`\\b${escapeRegExp(exp)}\\b`, 'i');
      return re.test(haystack);
    });

    if (hasAcro || hasExpansion) {
      aliasesSet.add(acro);
      if (Array.isArray(expansions)) {
        for (const exp of expansions) aliasesSet.add(exp);
      }
    }
  }

  return Array.from(aliasesSet);
}
// --- end helpers ---

// --- Query expansion helpers ---
function extractAcronymsFromQuery(q) {
  if (!q) return [];
  const tokens = String(q)
    .split(/\s+/)
    .map(t => t.toUpperCase().replace(/[^A-Z]/g, ''));
  const set = new Set();
  for (const t of tokens) {
    if (t && Object.prototype.hasOwnProperty.call(acronyms, t)) set.add(t);
  }
  return Array.from(set);
}

function expandQueryWithAcronyms(q) {
  const matched = extractAcronymsFromQuery(q);
  if (!matched.length) return { expanded: q, matched };
  const pieces = matched.map(acro => {
    const exps = Array.isArray(acronyms[acro]) ? acronyms[acro].join(' | ') : '';
    return `${acro}${exps ? ` (${exps})` : ''}`;
  });
  const expanded = `${q}\nAcronyms: ${pieces.join('; ')}`;
  return { expanded, matched };
}
// --- end query expansion helpers ---


function buildEmbeddingText({ name, organization, hidden, description, aliases }) {
  const parts = [];
  if (description) parts.push(`Description: ${(hidden ? String(hidden).trim() + " - " : "") + String(description).trim()}`);
  if (name) parts.push(`Service name: ${String(normalizeTextField(name)).trim()}`);
  //if (organization) parts.push(`Organization: ${String(organization).trim()}`);
  if (Array.isArray(aliases) && aliases.length) parts.push(`Aliases: ${aliases.join(', ')}`);

  const text = parts.join('\n');

  return text
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

app.get('/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return res.status(204).end(); // No Content
    }
    return res.download(LOG_FILE, 'requests-log.json');
  } catch (e) {
    console.error('⚠️ /logs failed:', e.message);
    return res.status(500).json({ error: 'Could not read logs' });
  }
});

app.post('/search', async (req, res) => {
  noStore(res);
  try {
    const query = req.body.query;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const { expanded, matched } = expandQueryWithAcronyms(query);

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: [expanded]
    });

    const embedding = response.data[0].embedding;

    const result = await index.query({
      vector: embedding,
      topK: 1000,
      includeMetadata: true
    });

    const BONUS = 0.05; // small nudge for exact acronym hits in aliases

    const matches = (result.matches || [])
      .map(match => {
        const aliases = match.metadata?.aliases || [];
        const hasExact = Array.isArray(aliases) && matched?.some(a => aliases.includes(a));
        const boostedScore = hasExact ? (match.score + BONUS) : match.score;
        return {
          id: match.id,
          score: boostedScore
        };
      })
      .sort((a, b) => b.score - a.score);

    logRequest(req, matches.map(match => {
      return {
        id: match.id,
        score: match.score
      };
    }));

    noStore(res);
    res.json({ results: matches });

  } catch (err) {
    console.error("🔥 Internal server error:", err);  // 🔍 See this in the logs
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/services', async (req, res) => {
  noStore(res);
  try {
    const services = await prisma.service.findMany({
      orderBy: { name: 'asc' },
    });

    res.json({ services });
  } catch (err) {
    console.error("🔥 Failed to fetch services:", err.message);
    res.status(500).json({ error: "Could not fetch services" });
  }
});

app.post('/update-service', async (req, res) => {
  noStore(res);
  try {
    const {
      id,
      name,
      hidden,
      description,
      complement,
      contact,
      research,
      phase,
      category,
      output,
      url,
      docs,
      organization,
      regional,
      active
    } = req.body;

    if (!id || !name) {
      return res.status(400).json({
        error: "Missing 'id' or 'name'"
      });
    }


    // Load existing record from Postgres
    const existing = await prisma.service.findUnique({ where: { id } });

    if (!existing) {
      return res.status(404).json({
        error: `Service with ID '${id}' not found in database.`
      });
    }

    // Detect acronyms/expansions present in the provided fields
    const aliases = buildAliasesForFields({ name, organization, hidden, description });

    // Normalization helpers
    const normArr = v =>
      Array.isArray(v)
        ? v
            .filter(x => typeof x === 'string' && x.trim().length)
            .map(x => x.trim())
        : [];
    const normStr = v => (v == null ? null : String(v));

    const regionalArray = Array.isArray(regional)
      ? regional
      : (typeof regional === 'string'
          ? regional.split(',').map(s => s.trim()).filter(Boolean)
          : []);

    // Prepare new data for DB update
    const newData = {
      name,
      organization: normStr(organization),
      regional: regionalArray,
      hidden: normStr(hidden),
      description: normStr(description),
      complement: normStr(complement),
      contact: normArr(contact),
      research: normArr(research),
      phase: normArr(phase),
      category: normArr(category),
      output: normArr(output),
      url: normArr(url),
      docs: normArr(docs),
      aliases,
      active: typeof active === 'boolean' ? active : existing.active
    };

    // Detect if embedding-relevant fields changed
    const embeddingFieldsChanged =
      (existing.name || '') !== (name || '') ||
      (existing.organization || '') !== (organization || '') ||
      (existing.hidden || '') !== (hidden || '') ||
      (existing.description || '') !== (description || '') ||
      !arraysEqual(existing.aliases || [], aliases || []);

    // Always update DB first (source of truth)
    const updatedService = await prisma.service.update({
      where: { id },
      data: newData
    });

    let pineconeUpdated = false;

    if (embeddingFieldsChanged) {
      const embeddingInput = buildEmbeddingText({
        name,
        organization,
        hidden,
        description,
        aliases
      });

      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: embeddingInput
      });

      const newEmbedding = embeddingResponse.data[0].embedding;
      const stamp = Date.now();

      // Metadata for Pinecone: keep in sync with DB, plus updatedAt
      const pineconeMetadata = {
        name: normalizeTextField(name),
        organization: normStr(organization),
        regional: regionalArray,
        hidden: normStr(hidden),
        description: normStr(description),
        complement: normStr(complement),
        contact: normArr(contact),
        research: normArr(research),
        phase: normArr(phase),
        category: normArr(category),
        output: normArr(output),
        url: normArr(url),
        docs: normArr(docs),
        aliases: Array.isArray(aliases) ? aliases : [],
        updatedAt: stamp
      };

      await index.upsert([
        { id, values: newEmbedding, metadata: pineconeMetadata }
      ]);

      pineconeUpdated = true;
      console.log(`✅ Updated service ${id} in DB and Pinecone`);
    } else {
      console.log(`✅ Updated service ${id} in DB (no embedding change)`);
    }

    noStore(res);
    res.json({
      success: true,
      message: `Service ${id} updated.`,
      service: updatedService,
      pineconeUpdated
    });
  } catch (err) {
    console.error("🔥 Failed to update service:", err);
    res.status(500).json({ error: "Could not update service", detail: err.message });
  }
});


app.post('/create-service', async (req, res) => {
  noStore(res);
  try {
    const {
      id,
      name,
      organization,
      regional,
      hidden,
      description,
      complement,
      contact,
      research,
      phase,
      category,
      output,
      url,
      docs,
      active
    } = req.body;

    // Minimal required fields
    if (!id || !name || !organization) {
      return res.status(400).json({
        error: "Missing 'id', 'name', or 'organization'."
      });
    }

    // Check if service already exists in DB
    const existing = await prisma.service.findUnique({ where: { id } });
    if (existing) {
      return res.status(400).json({
        error: `Service with ID '${id}' already exists in database.`,
      });
    }

    // Normalization helpers (same spirit as in /update-service)
    const normArr = v =>
      Array.isArray(v)
        ? v
            .filter(x => typeof x === 'string' && x.trim().length)
            .map(x => x.trim())
        : [];

    const normStr = v => (v == null ? null : String(v));

    const regionalArray = Array.isArray(regional)
      ? regional
      : (typeof regional === 'string'
          ? regional.split(',').map(s => s.trim()).filter(Boolean)
          : []);

    const contactArray = normArr(contact);
    const researchArray = normArr(research);
    const phaseArray = normArr(phase);
    const categoryArray = normArr(category);
    const outputArray = normArr(output);
    const urlArray = normArr(url);
    const docsArray = normArr(docs);

    // Detect aliases from the provided text fields
    const aliases = buildAliasesForFields({
      name,
      organization,
      hidden,
      description
    });

    // Create in DB (source of truth)
    const newService = await prisma.service.create({
      data: {
        id,
        name,
        organization: normStr(organization),
        regional: regionalArray,
        hidden: normStr(hidden),
        description: normStr(description),
        complement: normStr(complement),
        contact: contactArray,
        research: researchArray,
        phase: phaseArray,
        category: categoryArray,
        output: outputArray,
        url: urlArray,
        docs: docsArray,
        aliases,
        active: typeof active === 'boolean' ? active : true
      }
    });

    // Build text for embedding (same logic as elsewhere)
    const embeddingInput = buildEmbeddingText({
      name,
      organization,
      hidden,
      description,
      aliases
    });

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingInput
    });

    const embedding = embeddingResponse.data[0].embedding;
    const stamp = Date.now();

    const pineconeMetadata = {
      name: normalizeTextField(name),
      organization: normStr(organization),
      regional: regionalArray,
      hidden: normStr(hidden),
      description: normStr(description),
      complement: normStr(complement),
      contact: contactArray,
      research: researchArray,
      phase: phaseArray,
      category: categoryArray,
      output: outputArray,
      url: urlArray,
      docs: docsArray,
      aliases: Array.isArray(aliases) ? aliases : [],
      updatedAt: stamp
    };

    await index.upsert([
      {
        id,
        values: embedding,
        metadata: pineconeMetadata
      }
    ]);

    console.log(`✨ Created new service '${id}' in DB and Pinecone`);

    res.json({
      success: true,
      message: `Service ${id} saved.`,
      service: newService,
      pineconeIndexed: true
    });

  } catch (err) {
    console.error("🔥 Failed to create service:", err);
    res.status(500).json({
      error: "Could not create service",
      detail: err.message
    });
  }
});

app.post('/delete-service', async (req, res) => {
  noStore(res);
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Missing 'id'." });
    }

    // Check existence in DB first
    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: `Service '${id}' not found in database.` });
    }

    // Delete from DB (source of truth)
    await prisma.service.delete({ where: { id } });

    // Try to delete from Pinecone too
    try {
      // Depending on your client, this might be:
      // await index.deleteMany({ ids: [id] });
      await index.deleteOne(id);
      console.log(`🧹 Deleted service '${id}' from Pinecone and DB`);
    } catch (pineErr) {
      console.error(`⚠️ Deleted from DB but failed to delete '${id}' from Pinecone:`, pineErr);
    }

    res.json({
      success: true,
      message: `Service '${id}' deleted from DB and Pinecone (if present).`
    });
  } catch (err) {
    console.error("🔥 Failed to delete service:", err);
    res.status(500).json({ error: "Could not delete service", detail: err.message });
  }
});


// Route to generate GPT-4 explanations for match relevance
app.post('/explain-match', async (req, res) => {
  noStore(res);
  const { query, match } = req.body;

  if (!query || !match) {
    return res.status(400).json({ error: "Missing or invalid 'query' or 'match' in request body." });
  }

  // Expand the user's query with known acronyms and build a glossary for GPT
  const { expanded: expandedQuery, matched: matchedFromQuery } = expandQueryWithAcronyms(query);

  // Collect acronyms found in the matched service text as well
  const matchText = [match.name, match.hidden, match.description, Array.isArray(match.aliases) ? match.aliases.join(' ') : '']
    .filter(Boolean)
    .join('\n');
  const matchedFromService = extractAcronymsFromQuery(matchText);

  // Union of acronyms from query and service
  const allMatched = Array.from(new Set([...(matchedFromQuery || []), ...(matchedFromService || [])]));

  // Build a glossary section for the prompt
  let glossarySection = '';
  if (allMatched.length) {
    const lines = allMatched.map(acro => {
      const exps = Array.isArray(acronyms[acro]) ? acronyms[acro] : [];
      return `${acro}: ${exps.join(' | ')}`;
    }).filter(Boolean);
    if (lines.length) {
      glossarySection = `Acronym glossary (use these meanings):\n${lines.join('\n')}\n\n`;
    }
  }

  const explanationPrompt = `
You are helping a researcher understand why a service matches their query. When acronyms appear, use the glossary below; prefer writing the expansion first and the acronym in parentheses.

${glossarySection}Researcher query (expanded):
"${expandedQuery}"

Matched service:
Name: ${match.name}
Aliases: ${(Array.isArray(match.aliases) ? match.aliases.join(', ') : '')}
Description: ${match.hidden || ''} ${match.description || ''}

Provide a short, helpful explanation (2–4 sentences) of why it is relevant to the query. Be concrete and cite the specific phrases or capabilities that match the intent.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'You are a helpful assistant for researchers.' },
        { role: 'user', content: explanationPrompt }
      ]
    });

    const text = response.choices[0].message.content;

    res.json({ text });
  } catch (err) {
    console.error("🔥 Failed to generate explanations:", err.message);
    res.status(500).json({ error: "Could not generate explanations", detail: err.message });
  }
});

app.post('/proximity-score', async (req, res) => {
  noStore(res);
  try {
    const { serviceIds } = req.body;
    const orgIds = ["SBP", "Swiss-Cancer-Institute", "SCTO", "SPHN-DCC"];

    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return res.status(400).json({ error: "Missing or invalid 'serviceIds' array" });
    }

    const serviceResults = await index.fetch(serviceIds);
    const orgResult = await orgIndex.fetch(orgIds);

    const results = [];

    for (const serviceId of serviceIds) {
      const serviceVec = serviceResults.records?.[serviceId]?.values;
      if (!serviceVec) continue;

      const scores = [];

      for (const orgId of orgIds) {
        const orgVec = orgResult.records?.[orgId]?.values;
        if (!orgVec) continue;

        const dotProduct = serviceVec.reduce((sum, v, i) => sum + v * orgVec[i], 0);
        const magnitudeA = Math.sqrt(serviceVec.reduce((sum, v) => sum + v * v, 0));
        const magnitudeB = Math.sqrt(orgVec.reduce((sum, v) => sum + v * v, 0));
        const similarity = dotProduct / (magnitudeA * magnitudeB);
        scores.push({ organization: orgId, similarity });
      }

      results.push({ serviceId, scores });
    }

    res.json({ results });

  } catch (err) {
    console.error("🔥 Failed to compute proximity scores:", err);
    res.status(500).json({ error: "Could not compute proximity scores", detail: err.message });
  }
});


app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});