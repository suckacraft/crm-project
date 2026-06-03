// ─────────────────────────────────────────────────────────────────────────────
// feedback.js — the improvement loop, now built on the durable dataset layer.
//
// Examples are versioned + provenance-stamped (dataset/contract.js) and read
// through the store (dataset/store.js), so legacy data is migrated on read and
// the corpus is portable across product changes. Public API is unchanged, so the
// UI and crmBridge keep working.
// ─────────────────────────────────────────────────────────────────────────────

import { ls, ss, KEYS, uid } from "./storage.js";
import { LocalStore } from "./dataset/store.js";
import { makeExample, migrateExample, exampleToJsonl } from "./dataset/contract.js";

export function getFeedback() { return LocalStore.allExamples(); }

/**
 * Record one review outcome as a versioned, provenance-stamped example.
 * @param predicted  StandardizedQuote the extractor produced
 * @param corrected  StandardizedQuote after human edits (the label)
 * @param context    { fileName, extractor, model, promptVersion, docText }
 */
export function recordCorrection(predicted, corrected, context = {}) {
  const example = makeExample({
    predicted, corrected,
    diff: diffQuotes(predicted, corrected),
    context: { ...context, promptVersion: context.promptVersion || predicted?.meta?.promptVersion },
  });
  return LocalStore.appendExample(example);
}

export function clearFeedback() { LocalStore.clear(); }

/** Promote a correction into the golden eval set (its label becomes truth). */
export function promoteToGolden(exampleId) {
  const ex = getFeedback().find(e => e.id === exampleId);
  if (!ex) return null;
  const golden = getGolden();
  golden.push({
    id: uid(), name: ex.provenance?.fileName || ex.id, ts: new Date().toISOString(),
    inputExcerpt: ex.inputExcerpt, expected: ex.corrected,
    provenance: ex.provenance,
  });
  ss(KEYS.golden, golden);
  return golden[golden.length - 1];
}
export function getGolden() { return ls(KEYS.golden, []) || []; }

/** Field-level diff between predicted and corrected — where the model errs. */
export function diffQuotes(pred, corr) {
  const changes = [];
  const fields = [
    ["source.vendor", pred?.source?.vendor, corr?.source?.vendor],
    ["source.quoteNumber", pred?.source?.quoteNumber, corr?.source?.quoteNumber],
    ["source.currency", pred?.source?.currency, corr?.source?.currency],
    ["source.validUntil", pred?.source?.validUntil, corr?.source?.validUntil],
    ["totals.grandTotalCost", pred?.totals?.grandTotalCost, corr?.totals?.grandTotalCost],
  ];
  for (const [path, a, b] of fields)
    if (String(a ?? "") !== String(b ?? "")) changes.push({ path, from: a, to: b });

  const pLines = pred?.lineItems || [], cLines = corr?.lineItems || [];
  if (pLines.length !== cLines.length)
    changes.push({ path: "lineItems.count", from: pLines.length, to: cLines.length });
  const n = Math.min(pLines.length, cLines.length);
  for (let i = 0; i < n; i++) {
    for (const f of ["sku", "description", "category", "quantity", "unitCost", "extendedCost"]) {
      if (String(pLines[i][f] ?? "") !== String(cLines[i][f] ?? ""))
        changes.push({ path: `lineItems[${i}].${f}`, from: pLines[i][f], to: cLines[i][f] });
    }
  }
  return changes;
}

/** Serialize the dataset as canonical JSONL — the portable interchange format. */
export function exportJsonl() {
  return getFeedback().map(exampleToJsonl).join("\n");
}

/** Import a JSONL export back in (merge by id) — e.g. restoring on a new device. */
export function importJsonl(text) {
  const incoming = (text || "").split(/\r?\n/).filter(Boolean).map(line => {
    try { const o = JSON.parse(line); return migrateExample({ ...o, corrected: o.output, inputExcerpt: o.input }); }
    catch { return null; }
  }).filter(Boolean);
  return LocalStore.upsertExamples(incoming);
}
