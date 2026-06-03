// ─────────────────────────────────────────────────────────────────────────────
// Extractor interface + registry.
//
// An Extractor takes an IngestedDocument and returns a StandardizedQuote. This
// is the seam that lets us swap inference engines (mock today, Anthropic/OpenAI
// via the proxy now, your company LLM later) without touching the rest of the
// app. Register a new one here and it appears in the Settings dropdown.
//
// IngestedDocument shape (produced by ingest.js):
//   { fileName, mimeType, text, tables:[{name, rows:[[...]]}], pages, raw }
//
// Extractor contract:
//   id        : stable string id
//   label     : human label for the UI
//   needsKey  : whether it requires the proxy/provider to be configured
//   async extract(doc, opts) -> StandardizedQuote
// ─────────────────────────────────────────────────────────────────────────────

const registry = new Map();

export function registerExtractor(extractor) {
  if (!extractor?.id) throw new Error("extractor needs an id");
  registry.set(extractor.id, extractor);
}
export function getExtractor(id) { return registry.get(id); }
export function listExtractors() { return [...registry.values()]; }
