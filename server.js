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
console.log("🔧 Using Pinecone index:", process.env.PINECONE_INDEX);

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
      description: match.metadata?.hidden,
      description: match.metadata?.description,
      complement: match.metadata?.complement,
      contact: match.metadata?.contact,
      output: match.metadata?.output,
      url: match.metadata?.url,
      docs: match.metadata?.docs,
      regional: match.metadata?.regional
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
        description: meta.description || null,
        organization: meta.organization || null,
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

app.post('/update-service', async (req, res) => {
  try {
    const { id, name, hidden, description, complement, contact, url, docs, organization, regional } = req.body;

    if (!id || !description || !name) {
      return res.status(400).json({
        error: "Missing 'id', 'description', or 'name'"
      });
    }

    // Fetch existing metadata
    const fetchResult = await index.fetch([id]);
    const existing = fetchResult.vectors?.[id];
    const existingMetadata = existing?.metadata || {};

    if (!serviceIds.includes(id)) {
      return res.status(404).json({
        error: `Service ID '${id}' not recognized.`
      });
    }

    // Generate new embedding
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: description
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
app.post('/explain-matches', async (req, res) => {
  const { query, matches } = req.body;

  if (!query || !matches || !Array.isArray(matches)) {
    return res.status(400).json({ error: "Missing or invalid 'query' or 'matches' in request body." });
  }

  const explanationPrompt = `
You are helping a researcher understand why certain services match their query.

Researcher query:
"${query}"

Matched services:
${matches.map((m, i) => `${i + 1}. ${m.name || 'Unnamed service'} — ${m.description || 'No description available.'}`).join('\n')}

For each service, provide a short, helpful explanation of why it is relevant to the query.
Respond with a JSON array of strings, one explanation per service, in order.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant for researchers.' },
        { role: 'user', content: explanationPrompt }
      ],
      temperature: 0.7
    });

    const text = response.choices[0].message.content;
    const explanations = JSON.parse(text);

    if (!Array.isArray(explanations)) {
      throw new Error("Unexpected GPT response format. Expected JSON array.");
    }

    res.json({ explanations });
  } catch (err) {
    console.error("🔥 Failed to generate explanations:", err.message);
    res.status(500).json({ error: "Could not generate explanations", detail: err.message });
  }
});

app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});