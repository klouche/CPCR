const cors = require('cors');
require('dotenv').config();
const express = require('express');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

const serviceIds = require('./service_ids');
console.log('Loaded', serviceIds.length, 'service IDs');

const app = express();
app.use(cors());
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
            topK: 10,
            includeMetadata: true
        });

        const matches = result.matches.map(match => ({
            id: match.id,
            score: match.score,
            service_name: match.metadata?.service_name,
            description: match.metadata?.description,
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
        service_name: meta.service_name || null,
        description: meta.description || null
      });
    }

    console.log(`✅ Fetched ${results.length} services from Pinecone`);
    res.json({ services: results });

  } catch (err) {
    console.error("🔥 Failed to fetch services:", err.message);
    res.status(500).json({ error: "Could not fetch services" });
  }
});

app.listen(3000, () => {
    console.log('🚀 Server running at http://localhost:3000');
});