// utils/embeddings.js
// Helper functions for calling Hugging Face Text Embeddings Inference (TEI)
// and formatting vectors for pgvector.

// Optional acronym expansion to improve retrieval quality for queries like "CT".
// This keeps all processing local (no external calls) and makes acronym queries
// behave more like their expanded forms.
let ACRONYMS = {};
try {
  // utils/embeddings.js lives in ./utils, so acronym.json is one level up
  ACRONYMS = require('../acronym.json') || {};
} catch (_) {
  ACRONYMS = {};
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Expand acronyms inline: "CT" -> "CT (Clinical trials)"
// We only add the expansion when the acronym is a whole word and is not already
// followed by parentheses.
function expandAcronymsInline(text) {
  const s = String(text ?? '');
  if (!s.trim()) return s;

  let out = s;
  for (const [acro, exps] of Object.entries(ACRONYMS || {})) {
    if (!acro) continue;
    const first = Array.isArray(exps) ? exps.find(e => typeof e === 'string' && e.trim().length) : null;
    if (!first) continue;

    const re = new RegExp(`\\b${escapeRegExp(acro)}\\b(?!\\s*\\()`, 'gi');
    out = out.replace(re, (m) => `${m} (${first})`);
  }

  return out;
}

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
  const arr = asArray(passages).map(s => {
    const t = expandAcronymsInline(String(s ?? '').trim());
    return `passage: ${t}`;
  });
  return teiEmbed(arr);
}

async function embedQueries(queries) {
  const arr = asArray(queries).map(s => {
    const t = expandAcronymsInline(String(s ?? '').trim());
    return `query: ${t}`;
  });
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
  expandAcronymsInline,
};