// ─────────────────────────────────────────────────────────────────────────────
// contract.js — the portable, versioned shape of a learning example.
//
// This is the durable contract for the corpus: it is deliberately decoupled from
// the UI, the storage backend, and the specific LLM. As long as data conforms to
// this (or can be migrated to it), the learnings transfer to ANY future product.
//
// An example pairs the model input with the human-approved output, plus the
// provenance needed to compare runs after the product changes (which app, which
// quote schema, which extractor/model/prompt produced the prediction).
// ─────────────────────────────────────────────────────────────────────────────

import { APP_VERSION, EXAMPLE_SCHEMA_VERSION } from "../version.js";
import { SCHEMA_VERSION } from "../schema.js";

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/** Build a versioned example with full provenance. */
export function makeExample({ predicted, corrected, diff = [], context = {} }) {
  return {
    exampleSchemaVersion: EXAMPLE_SCHEMA_VERSION,
    id: context.id || uid(),
    capturedAt: new Date().toISOString(),
    provenance: {
      appVersion: context.appVersion || APP_VERSION,
      quoteSchemaVersion: corrected?.schemaVersion || predicted?.schemaVersion || SCHEMA_VERSION,
      extractor: context.extractor || predicted?.meta?.extractor || "",
      model: context.model || predicted?.meta?.model || "",
      promptVersion: context.promptVersion || predicted?.meta?.promptVersion || "",
      vendor: corrected?.source?.vendor || "",
      fileName: context.fileName || corrected?.source?.fileName || "",
    },
    // Self-contained so the example is usable for training/eval without the
    // original file. Excerpt-capped to keep storage bounded.
    inputExcerpt: (context.docText || "").slice(0, 8000),
    predicted,        // what the extractor said
    corrected,        // the human-approved truth (the label)
    diff,             // field-level changes (analytics: where the model errs)
  };
}

/**
 * Upgrade any older/foreign example to the current contract. Never drop data —
 * transform it. This is what makes the corpus survive schema evolution.
 */
export function migrateExample(ex) {
  if (!ex || typeof ex !== "object") return null;
  let v = ex.exampleSchemaVersion || 0;

  if (v === 0) {
    // Legacy v0 (the first feedback.js shape):
    //   { id, ts, fileName, extractor, model, inputExcerpt, predicted, corrected, diff }
    ex = {
      exampleSchemaVersion: 1,
      id: ex.id || uid(),
      capturedAt: ex.ts || ex.capturedAt || new Date().toISOString(),
      provenance: {
        appVersion: ex.appVersion || "legacy",
        quoteSchemaVersion: ex.predicted?.schemaVersion || ex.corrected?.schemaVersion || "",
        extractor: ex.extractor || "",
        model: ex.model || "",
        promptVersion: ex.promptVersion || "",
        vendor: ex.corrected?.source?.vendor || "",
        fileName: ex.fileName || "",
      },
      inputExcerpt: ex.inputExcerpt || "",
      predicted: ex.predicted || null,
      corrected: ex.corrected || null,
      diff: ex.diff || [],
    };
    v = 1;
  }
  // Future migrations chain here: if (v === 1) { …; v = 2; }
  return ex;
}

/** Canonical JSONL line for export / interchange / training. */
export function exampleToJsonl(ex) {
  return JSON.stringify({
    id: ex.id,
    input: ex.inputExcerpt,
    output: ex.corrected,
    provenance: ex.provenance,
    capturedAt: ex.capturedAt,
    exampleSchemaVersion: ex.exampleSchemaVersion,
  });
}
