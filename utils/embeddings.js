// utils/embeddings.js
// Helper functions for calling Hugging Face Text Embeddings Inference (TEI)
// and formatting vectors for pgvector.

// Node 18+ provides global fetch. If you run in older Node, install node-fetch.

function getEmbeddingsBaseUrl() {
  const base = process.env.EMBEDDINGS_BASE_URL || 'http://localhost:8080';
  return String(base).replace(/\/$/, '');
}

async function teiEmbed(inputs) {
  const baseUrl = getEmbeddingsBaseUrl();
  const payload = { inputs };

  const controller = new AbortController();
  const timeoutMs = Number(process.env.EMBEDDINGS_TIMEOUT_MS || 60000);
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`TEI /embed failed (${res.status}): ${txt}`);
    }

    const data = await res.json();

    // TEI typically returns: number[][] (one vector per input)
    if (!Array.isArray(data)) {
      throw new Error('Unexpected TEI response: expected an array');
    }

    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`TEI /embed request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function asArray(x) {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  return [x];
}

// E5-style prompting: use explicit prefixes for best retrieval quality.
async function embedPassages(passages) {
  const arr = asArray(passages).map(s => `passage: ${String(s ?? '').trim()}`);
  return teiEmbed(arr);
}

async function embedQueries(queries) {
  const arr = asArray(queries).map(s => `query: ${String(s ?? '').trim()}`);
  return teiEmbed(arr);
}

// Convert a JS vector (number[]) into a pgvector literal: '[0.1,0.2,...]'
function toPgVectorLiteral(vec) {
  if (!Array.isArray(vec)) throw new Error('toPgVectorLiteral expected an array');
  return `[${vec.join(',')}]`;
}

module.exports = {
  teiEmbed,
  embedPassages,
  embedQueries,
  toPgVectorLiteral,
};