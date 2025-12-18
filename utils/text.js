const { decode } = require('html-entities');

function normalizeTextField(v) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(normalizeTextField);
  if (typeof v === 'object') return v;
  return decode(String(v).trim());
}

module.exports = { normalizeTextField };