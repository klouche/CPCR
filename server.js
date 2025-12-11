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
const bcrypt = require('bcrypt');

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

function logRequest(req, resBody, meta = {}) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      ip: getClientIp(req),
      query: req.body?.query,
      result: resBody,
      ...meta
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

app.use(express.static(path.join(__dirname, 'public')));


const session = require('express-session');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

app.use(
  session({
    name: 'cpcr.sid',         // cookie name
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // secure: true,        // uncomment when behind HTTPS in production
      maxAge: 1000 * 60 * 60 * 8 // 8 hours
    }
  })
);



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


// ============================================================================
// AUTH ROUTES
// ============================================================================

// POST /api/login  { username, password }
// Handles user login, verifies credentials against the User table,
// sets an authenticated session, and returns user + organization info.
// For now, "username" is treated as the user's email.
app.post('/api/login', express.json(), async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  try {
    // Look up user by email (username)
    const user = await prisma.user.findUnique({
      where: { email: username },
      include: { organization: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Store minimal info in session
    req.session.user = {
      id: user.id,
      email: user.email,
      role: 'admin',
      organizationCode: user.organizationCode,
      isSuperAdmin: user.isSuperAdmin
    };
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: 'admin',
        organizationCode: user.organizationCode,
        isSuperAdmin: user.isSuperAdmin,
        organization: user.organization
      }
    });
  } catch (err) {
    console.error('🔥 Failed to log in user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/me
// Returns the currently authenticated user (if any), including
// their organization information, based on the session cookie.
// ---------------------------------------------------------------------------
// GET /me → returns current session user with organization info
app.get('/api/me', async (req, res) => {
  if (!req.session.user) {
    return res.status(200).json({ authenticated: false });
  }

  try {
    const sessionUser = req.session.user;

    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      include: { organization: true }
    });

    if (!user) {
      return res.status(200).json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        role: sessionUser.role || 'admin',
        organizationCode: user.organizationCode,
        organization: user.organization
      }
    });
  } catch (err) {
    console.error('🔥 Failed to fetch current user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/logout
// Destroys the current session and clears the auth cookie.
// ---------------------------------------------------------------------------
// POST /logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Failed to destroy session:', err);
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.clearCookie('cpcr.sid');
    res.json({ success: true });
  });
});


function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}


// ============================================================================
// LOGS ROUTE
// ============================================================================
// GET /api/logs
// Streams the JSON log file of past search requests (if present).
app.get('/api/logs', (req, res) => {
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

// ============================================================================
// SEARCH ROUTE
// ============================================================================
// POST /api/search
// Takes a free-text query, expands acronyms, creates an embedding,
// queries Pinecone, and returns ranked service IDs with scores.
app.post('/api/search', async (req, res) => {
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

    logRequest(
      req,
      matches.map(match => ({ id: match.id, score: match.score })),
      { type: 'search' }
    );

    noStore(res);
    res.json({ results: matches });

  } catch (err) {
    console.error("🔥 Internal server error:", err);  // 🔍 See this in the logs
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// SERVICES LIST ROUTE
// ============================================================================
// GET /api/services
// Returns all services from Postgres, including their Organization relation.
app.get('/api/services', async (req, res) => {
  noStore(res);
  try {
    const services = await prisma.service.findMany({
      orderBy: { name: 'asc' },
      include: {
        organization: true,
      },
    });

    res.json({ services });
  } catch (err) {
    console.error("🔥 Failed to fetch services:", err.message);
    res.status(500).json({ error: "Could not fetch services" });
  }
});

// ============================================================================
// UPDATE SERVICE ROUTE
// ============================================================================
// POST /api/update-service
// Requires authentication. Updates a service in Postgres, and when relevant
// also regenerates the embedding and updates the corresponding Pinecone vector.
app.post('/api/update-service', requireAuth, async (req, res) => {
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
      organizationCode: normStr(organization),
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
      (existing.organizationCode || '') !== (organization || '') ||
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

    // Log the service update in the same log file as searches
    logRequest(
      req,
      {
        action: 'update-service',
        id,
        updatedFields: newData,
        pineconeUpdated,
        user: req.session?.user?.email || null
      },
      { type: 'service-change' }
    );

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


// ============================================================================
// CREATE SERVICE ROUTE
// ============================================================================
// POST /api/create-service
// Creates a new service in Postgres and indexes it in Pinecone with a fresh
// embedding and metadata derived from the service fields.
app.post('/api/create-service', requireAuth, async (req, res) => {
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
        organizationCode: normStr(organization),
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

    // Log the service creation in the same log file as searches
    logRequest(
      req,
      {
        action: 'create-service',
        id,
        data: newService,
        pineconeIndexed: true,
        user: req.session?.user?.email || null
      },
      { type: 'service-change' }
    );

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

// ============================================================================
// DELETE SERVICE ROUTE
// ============================================================================
// POST /api/delete-service
// Deletes a service from Postgres and attempts to remove its vector from
// Pinecone as well.
app.post('/api/delete-service', requireAuth, async (req, res) => {
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

    // Log the service deletion in the same log file as searches
    logRequest(
      req,
      {
        action: 'delete-service',
        id,
        user: req.session?.user?.email || null
      },
      { type: 'service-change' }
    );

    res.json({
      success: true,
      message: `Service '${id}' deleted from DB and Pinecone (if present).`
    });
  } catch (err) {
    console.error("🔥 Failed to delete service:", err);
    res.status(500).json({ error: "Could not delete service", detail: err.message });
  }
});


// ============================================================================
// EXPLAIN MATCH ROUTE
// ============================================================================
// POST /api/explain-match
// Uses GPT to generate a short human-readable explanation for why a given
// service matches a user query, including acronym expansions.
// Route to generate GPT-4 explanations for match relevance
app.post('/api/explain-match', async (req, res) => {
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

// ============================================================================
// PROXIMITY SCORE ROUTE
// ============================================================================
// POST /api/proximity-score
// Computes cosine-like similarity scores between service vectors and a
// fixed set of organization vectors stored in the orgIndex.
app.post('/api/proximity-score', async (req, res) => {
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


// ============================================================================
// SERVER STARTUP
// ============================================================================
app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});