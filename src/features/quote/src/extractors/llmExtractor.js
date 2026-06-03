// ─────────────────────────────────────────────────────────────────────────────
// LLMExtractor — sends the ingested document to the serverless proxy, which
// holds the API keys and calls Anthropic or OpenAI. The browser NEVER sees a
// provider key; it only talks to our proxy.
//
// Provider/model are chosen in Settings and passed through, so the same
// extractor drives both Claude Haiku and GPT-4o-mini (and, later, your company
// LLM — just add a provider in the proxy; this file doesn't change).
// ─────────────────────────────────────────────────────────────────────────────

import { registerExtractor } from "./base.js";
import { normalizeExtraction } from "../normalize.js";
import { getSettings, authHeaders } from "../storage.js";

export const llmExtractor = {
  id: "llm",
  label: "LLM via proxy (Claude / GPT)",
  needsKey: true,
  async extract(doc) {
    const s = getSettings();
    const endpoint = (s.proxyUrl || "/api/extract").replace(/\/$/, "");
    const t0 = performance.now();

    const payload = {
      provider: s.provider || "anthropic",   // "anthropic" | "openai"
      model: s.model || "",                   // blank → proxy default
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      // Send both a flat text view and the structured tables; the proxy builds
      // the prompt. Cap size so a giant spreadsheet can't blow the context.
      documentText: (doc.text || "").slice(0, 60000),
      tables: (doc.tables || []).map(t => ({ name: t.name, rows: t.rows.slice(0, 400) })),
    };

    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error(`Could not reach extraction proxy at ${endpoint}. Is it running? (${e.message})`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Proxy error ${res.status}: ${detail.slice(0, 300)}`);
    }
    const body = await res.json();

    // The proxy returns { raw, meta } where raw is the model's JSON. We normalize
    // client-side too so behaviour is identical whether the proxy normalized or
    // not (defensive — keeps the schema contract in one place).
    const raw = body.raw ?? body;
    return normalizeExtraction(raw, {
      extractor: "llm",
      model: body.meta?.model || payload.model || payload.provider,
      promptVersion: body.meta?.promptVersion || "",
      durationMs: Math.round(performance.now() - t0),
      fileName: doc.fileName,
    });
  },
};
registerExtractor(llmExtractor);
