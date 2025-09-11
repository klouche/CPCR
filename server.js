require('dotenv').config();
const cors = require('cors');
const express = require('express');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const acronyms = require('./acronym.json');
const { normalizeTextField } = require('./utils/text.js');
const fs = require('fs');
const path = require('path');

const LOG_FILE = '/var/data/requests-log.json';
// make sure log file exists
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '[]'); // initialize empty JSON array
}

function logRequest(req, resBody) {
  const entry = {
    timestamp: new Date().toISOString(),
    ip: req.ip,
    body: req.body,
    result: resBody
  };

  const logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  logs.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

const serviceIds = require('./service_ids');
console.log('Loaded', serviceIds.length, 'service IDs');

// In-memory overlay for recently updated services to defeat eventual consistency
const recentUpdates = new Map(); // id -> { metadata, updatedAt }

const app = express();
const allowedOrigins = ['http://localhost:3000', 'https://swissbiobanking.ch'];
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
  if (organization) parts.push(`Organization: ${String(organization).trim()}`);
  if (Array.isArray(aliases) && aliases.length) parts.push(`Aliases: ${aliases.join(', ')}`);

  const text = parts.join('\n');

  return text
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

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
      topK: 5,
      includeMetadata: true
    });

    const BONUS = 0.05; // small nudge for exact acronym hits in aliases

    const matches = result.matches
      .map(match => {
        const aliases = match.metadata?.aliases || [];
        const hasExact = Array.isArray(aliases) && matched?.some(a => aliases.includes(a));
        const boostedScore = hasExact ? (match.score + BONUS) : match.score;
        return {
          id: match.id,
          score: boostedScore,
          name: match.metadata?.name,
          hidden: match.metadata?.hidden,
          description: match.metadata?.description,
          complement: match.metadata?.complement,
          contact: match.metadata?.contact,
          output: match.metadata?.output,
          url: match.metadata?.url,
          docs: match.metadata?.docs,
          regional: match.metadata?.regional,
          organization: match.metadata?.organization,
          aliases
        };
      })
      .sort((a, b) => b.score - a.score);

    logRequest(req, matches.map(match => {
      return {
        "id": match.id,
        "name": match.name,
      }
    }
    ));

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
    const results = [];

    // Fetch all vectors (adjust batch size if needed later)
    const vectorData = await index.fetch(serviceIds);

    const records = vectorData.records || {}; // ✅ not .vectors

    for (const id in records) {

      const rec = records[id] || {}
      const fromFetch = rec.metadata || {}
      const overlay = recentUpdates.get(id)
      const meta = overlay?.metadata && overlay.updatedAt ? { ...fromFetch, ...overlay.metadata, updatedAt: overlay.updatedAt } : fromFetch

      results.push({
        id,
        name: meta.name || null,
        hidden: meta.hidden || null,
        description: meta.description || null,
        organization: meta.organization || null,
        hidden: meta.hidden || null,
        regional: meta.regional || null,
        complement: meta.complement || null,
        contact: meta.contact || null,
        output: meta.output || null,
        url: meta.url || null,
        docs: meta.docs || null,
        aliases: meta.aliases || null,
        updatedAt: meta.updatedAt || null,
      });
    }

    console.log(`✅ Fetched ${results.length} services from Pinecone`);
    res.json({ services: results });

  } catch (err) {
    console.error("🔥 Failed to fetch services:", err.message);
    res.status(500).json({ error: "Could not fetch services" });
  }
});

app.post('/update-metadata', async (req, res) => {
  noStore(res);

  try {
    const { id, name, hidden, description, complement, contact, output, url, docs, organization, regional } = req.body;

    if (!id || !description || !name) {
      return res.status(400).json({
        error: "Missing 'id', 'description', or 'name'"
      });
    }

    // Fetch existing metadata
    const fetchResult = await index.fetch([id]);
    const existing = fetchResult.records?.[id];
    const existingMetadata = existing?.metadata || {};
    if (!existing) {
      return res.status(404).json({
        error: `Service ID '${id}' not found in Pinecone index.`
      });
    }
    if (!serviceIds.includes(id)) {
      return res.status(404).json({
        error: `Service ID '${id}' not recognized.`
      });
    }

    // Build normalized metadata (Pinecone supports lists of strings)
    const normArr = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim().length).map(x => x.trim()) : []
    const normStr = v => (v == null ? null : String(v))
    const stamp = Date.now()

    const newMetadata = {
      ...existingMetadata,
      name: normalizeTextField(name),
      organization: normStr(organization),
      regional: Array.isArray(regional) ? regional : (typeof regional === 'string' ? regional.split(',').map(s => s.trim()).filter(Boolean) : []),
      hidden: normStr(hidden),
      description: normStr(description),
      complement: normStr(complement),
      contact: normArr(contact),
      output: normArr(output),
      url: normArr(url),
      docs: normArr(docs),
      updatedAt: stamp
    }

    // Upsert vector with existing values but new metadata
    await index.upsert([
      { id, values: existing.values, metadata: newMetadata }
    ]);

    // Update in-memory overlay so subsequent /services reflect this immediately
    recentUpdates.set(id, { metadata: newMetadata, updatedAt: stamp })

    console.log(`✅ Updated service ${id}`);
    noStore(res);
    res.json({ success: true, message: `Service ${id} updated.`, service: { id, ...newMetadata } });
  } catch (err) {
    console.error("🔥 Failed to update service:", err);
    res.status(500).json({ error: "Could not update service", detail: err.message });
  }
});

app.post('/update-service', async (req, res) => {
  noStore(res);
  try {
    const { id, name, hidden, description, complement, contact, output, url, docs, organization, regional } = req.body;

    if (!id || !description || !name) {
      return res.status(400).json({
        error: "Missing 'id', 'description', or 'name'"
      });
    }

    // Fetch existing metadata
    const fetchResult = await index.fetch([id]);
    const existing = fetchResult.records?.[id];
    const existingMetadata = existing?.metadata || {};

    if (!serviceIds.includes(id)) {
      return res.status(404).json({
        error: `Service ID '${id}' not recognized.`
      });
    }

    // Detect acronyms/expansions present in the provided fields
    const aliases = buildAliasesForFields({ name, organization, hidden, description });
    // Generate new embedding from multiple metadata fields + aliases
    const embeddingInput = buildEmbeddingText({ name, organization, hidden, description, aliases });

    console.log(embeddingInput)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingInput
    });

    const newEmbedding = embeddingResponse.data[0].embedding;

    // Normalize fields and build metadata
    const normArr = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim().length).map(x => x.trim()) : []
    const normStr = v => (v == null ? null : String(v))
    const stamp = Date.now()

    const newMetadata = {
      ...existingMetadata,
      name: normalizeTextField(name),
      organization: normStr(organization),
      regional: Array.isArray(regional) ? regional : (typeof regional === 'string' ? regional.split(',').map(s => s.trim()).filter(Boolean) : []),
      hidden: normStr(hidden),
      description: normStr(description),
      complement: normStr(complement),
      contact: normArr(contact),
      output: normArr(output),
      url: normArr(url),
      docs: normArr(docs),
      aliases: Array.isArray(aliases) ? aliases : [],
      updatedAt: stamp
    }
    await index.upsert([
      { id, values: newEmbedding, metadata: newMetadata }
    ]);

    // Update in-memory overlay
    recentUpdates.set(id, { metadata: newMetadata, updatedAt: stamp })

    console.log(`✅ Updated service ${id}`);
    noStore(res);
    res.json({ success: true, message: `Service ${id} updated.`, service: { id, ...newMetadata } });
  } catch (err) {
    console.error("🔥 Failed to update service:", err);
    res.status(500).json({ error: "Could not update service", detail: err.message });
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