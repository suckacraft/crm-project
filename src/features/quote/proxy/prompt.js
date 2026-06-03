// ─────────────────────────────────────────────────────────────────────────────
// prompt.js — builds the extraction prompt from an ingested document.
//
// The JSON contract (SCHEMA_PROMPT) is imported from the browser app's schema.js
// so the prompt and the StandardizedQuote shape are guaranteed to agree. The
// prompt lives server-side: improving extraction quality = redeploy the proxy,
// the browser stays unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { SCHEMA_PROMPT } from "../src/schema.js";

// Bump when the prompt changes — stamped onto every extraction's provenance so
// the corpus records which prompt produced a prediction (essential for proving
// a prompt change actually improved accuracy).
export const PROMPT_VERSION = "extract-v1";

export const SYSTEM_PROMPT =
`You are a precise data-extraction engine for IT reseller and distributor quotes.
Resellers format quotes wildly differently (Ingram, TD Synnex, CDW, Insight, plus
direct-vendor PDFs and ad-hoc spreadsheets). Your job is to locate the line items
and pricing wherever they sit and return a single, strict, standardized JSON
object. You never add prose. You never invent SKUs or prices. When unsure, lower
the confidence and add a warning rather than guessing.

${SCHEMA_PROMPT}`;

export function buildUserPrompt({ fileName, mimeType, documentText, tables }) {
  const parts = [];
  parts.push(`SOURCE FILE: ${fileName || "unknown"} (${mimeType || "unknown type"})`);

  if (tables && tables.length) {
    parts.push("\n=== STRUCTURED TABLES (highest signal — prefer these) ===");
    for (const t of tables) {
      parts.push(`\n--- ${t.name} ---`);
      // Render as TSV so column alignment survives.
      parts.push(t.rows.map(r => r.map(c => String(c ?? "")).join("\t")).join("\n"));
    }
  }
  if (documentText) {
    parts.push("\n=== RAW DOCUMENT TEXT (fallback / context) ===");
    parts.push(documentText);
  }
  parts.push("\nExtract the standardized JSON now.");
  return parts.join("\n");
}
