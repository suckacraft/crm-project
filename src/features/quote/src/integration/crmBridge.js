// ─────────────────────────────────────────────────────────────────────────────
// crmBridge.js — THE integration seam with crm-project.
//
// This is the only module the CRM imports. Keep every CRM-facing call here so
// the merge surface stays one small file. When the repos fuse, the CRM's
// openQuoteForm (buy quote) calls buildBuyQuoteFromFile() to auto-fill the
// amount + HW/SW/PS categories it currently makes a human type by hand.
//
// Nothing here touches the DOM — the CRM owns its own UI; we just hand it data.
// ─────────────────────────────────────────────────────────────────────────────

import { ingestFile } from "../ingest.js";
import { getExtractor, listExtractors } from "../extractors/base.js";
import "../extractors/mockExtractor.js";   // registers "mock"
import "../extractors/llmExtractor.js";    // registers "llm"
import { toCrmBuyQuote, toCrmLineItems } from "../crmAdapter.js";
import { getSettings, configureStorage } from "../storage.js";
import { recordCorrection } from "../feedback.js";

/**
 * Call once when mounting inside the CRM, so the parser writes to the same
 * per-user localStorage namespace as the CRM.
 * @param userId  the CRM's current user id (KG.session user)
 */
export function initForCrm({ userId } = {}) {
  migrateStandaloneData(userId);                       // carry over standalone dev data
  configureStorage({ prefix: "kb", scope: userId || "" });
  return { extractors: listExtractors().map(e => ({ id: e.id, label: e.label, needsKey: e.needsKey })) };
}

/**
 * One-time carry-over of POC data collected in standalone mode (qp_* keys) into
 * the CRM's per-user namespace (kb_<name>_u<uid>), so feedback/golden/settings
 * gathered while testing aren't lost at merge. Idempotent: never overwrites an
 * existing target. Mirrors the CRM's own migrateExistingDataToUser pattern.
 */
export function migrateStandaloneData(userId) {
  if (typeof localStorage === "undefined" || !userId) return { migrated: 0 };
  let migrated = 0;
  for (const name of ["settings", "feedback", "golden"]) {
    const src = `qp_${name}`;
    const dst = `kb_${name}_u${userId}`;
    const val = localStorage.getItem(src);
    if (val != null && localStorage.getItem(dst) == null) { localStorage.setItem(dst, val); migrated++; }
  }
  return { migrated };
}

/** Ingest + extract a file into a StandardizedQuote (+ the raw ingested doc). */
export async function parseQuoteFile(file, { extractorId } = {}) {
  const doc = await ingestFile(file);
  const ex = getExtractor(extractorId || getSettings().extractorId);
  if (!ex) throw new Error(`unknown extractor "${extractorId}"`);
  const quote = await ex.extract(doc);
  return { doc, quote };
}

/**
 * One call → everything the CRM's buy-quote form needs.
 * @param file     the uploaded File
 * @param fileMeta { id, name, type, size, dataUrl } the CRM already builds
 * @returns { quote, buyQuote, lineItems, doc }
 *   buyQuote  → push into getOppFileData(oppId).buyQuotes
 *   lineItems → opp.lineItems (pre-fills the deal's buy figures)
 */
export async function buildBuyQuoteFromFile(file, fileMeta = {}, opts = {}) {
  const { doc, quote } = await parseQuoteFile(file, opts);
  return {
    doc,
    quote,
    buyQuote: toCrmBuyQuote(quote, fileMeta),
    lineItems: toCrmLineItems(quote),
  };
}

/**
 * After the human confirms/edits the pre-filled values in the CRM, call this so
 * the correction feeds the improvement loop (predicted vs final).
 */
export function recordReview(predicted, finalQuote, context = {}) {
  return recordCorrection(predicted, finalQuote, context);
}

// Re-export the low-level mappers for callers that want them directly.
export { toCrmBuyQuote, toCrmLineItems };

// Embeddable review/correction panel — mount in the CRM's quote-detail pane to
// capture line-item-level corrections (the high-fidelity training signal).
export { mountReviewPanel } from "../ui/reviewPanel.js";
