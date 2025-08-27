const cors = require('cors');
require('dotenv').config();
const express = require('express');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

const serviceIds = require('./service_ids');
console.log('Loaded', serviceIds.length, 'service IDs');

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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.Index(process.env.PINECONE_INDEX);
const orgIndex = pinecone.Index("infrastructure-index");
console.log("🔧 Using Pinecone index:", process.env.PINECONE_INDEX);

// Build a single text string for embeddings from multiple metadata fields
function buildEmbeddingText({ name, organization, hidden, description }) {
  const parts = [];
  if (description) parts.push(`Description: ${(hidden? String(hidden).trim() + " - ":"") + String(description).trim()}`);
  if (name) parts.push(`Service name: ${String(name).trim()}`);
  if (organization) parts.push(`Organization: ${String(organization).trim()}`);

  // Join with newlines to give the model light structure
  const text = parts.join('\n');

  // Normalize whitespace/newlines to avoid accidental duplication
  return text
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

app.post('/search', async (req, res) => {
  try {
    const query = req.body.query;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: [query]
    });

    const embedding = response.data[0].embedding;

    const result = await index.query({
      vector: embedding,
      topK: 5,
      includeMetadata: true
    });

    const matches = result.matches.map(match => ({
      id: match.id,
      score: match.score,
      name: match.metadata?.name,
      hidden: match.metadata?.hidden,
      description: match.metadata?.description,
      complement: match.metadata?.complement,
      contact: match.metadata?.contact,
      output: match.metadata?.output,
      url: match.metadata?.url,
      docs: match.metadata?.docs,
      regional: match.metadata?.regional,
      organization: match.metadata?.organization
    }));

    res.json({ results: matches });

  } catch (err) {
    console.error("🔥 Internal server error:", err);  // 🔍 See this in the logs
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/services', async (req, res) => {
  try {
    const results = [];

    // Fetch all vectors (adjust batch size if needed later)
    const vectorData = await index.fetch(serviceIds);

    const records = vectorData.records || {}; // ✅ not .vectors

    for (const id in records) {
      const meta = records[id].metadata || {};
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

    // Upsert vector
    await index.upsert([
      {
        id,
        values: existing.values,
        metadata: {
          ...existingMetadata,
          name: name,
          organization: organization,
          regional: regional,
          hidden: hidden,
          description: description,
          complement: complement,
          contact: contact,
          output: output,
          url: url,
          docs: docs
        }
      }
    ]);

    console.log(`✅ Updated service ${id}`);
    res.json({ success: true, message: `Service ${id} updated.` });

  } catch (err) {
    console.error("🔥 Failed to update service:", err);
    res.status(500).json({ error: "Could not update service", detail: err.message });
  }
});

app.post('/update-service', async (req, res) => {
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

    // Generate new embedding from multiple metadata fields
    const embeddingInput = buildEmbeddingText({ name, organization, hidden, description });

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingInput
    });

    const newEmbedding = embeddingResponse.data[0].embedding;

    // Upsert vector
    await index.upsert([
      {
        id,
        values: newEmbedding,
        metadata: {
          ...existingMetadata,
          name: name,
          organization: organization,
          regional: regional,
          hidden: hidden,
          description: description,
          complement: complement,
          contact: contact,
          output: output,
          url: url,
          docs: docs
        }
      }
    ]);

    console.log(`✅ Updated service ${id}`);
    res.json({ success: true, message: `Service ${id} updated.` });

  } catch (err) {
    console.error("🔥 Failed to update service:", err);
    res.status(500).json({ error: "Could not update service", detail: err.message });
  }
});



// Route to generate GPT-4 explanations for match relevance
app.post('/explain-match', async (req, res) => {
  const { query, match } = req.body;

  if (!query || !match) {
    return res.status(400).json({ error: "Missing or invalid 'query' or 'match' in request body." });
  }

  const explanationPrompt = `
You are helping a researcher understand why a service match their query.

Researcher query:
"${query}"

Matched service:
Name: ${match.name}, Description: ${match.hidden}, ${match.description}

Provide a short, helpful explanation of why it is relevant to the query.
  `;

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