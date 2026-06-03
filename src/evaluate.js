// ─────────────────────────────────────────────────────────────────────────────
// evaluate.js — makes "better inferencing over time" measurable.
//
// Given a golden set ({ inputExcerpt, expected StandardizedQuote }) and an
// extractor, run the extractor on each case and score it:
//   • line-item precision / recall / F1 (matched on SKU, then description)
//   • category accuracy on matched lines
//   • mean absolute % error on the grand total
//   • field accuracy on key header fields
//
// Pure logic (no DOM) so it can run in the browser app or in CI later.
// ─────────────────────────────────────────────────────────────────────────────

import { num } from "./schema.js";

/**
 * @param goldenCases  [{ name, inputExcerpt, expected }]
 * @param runExtractor async (inputExcerpt, name) -> StandardizedQuote
 */
export async function runEval(goldenCases, runExtractor) {
  const perCase = [];
  for (const gc of goldenCases) {
    let predicted;
    try { predicted = await runExtractor(gc.inputExcerpt, gc.name); }
    catch (e) { perCase.push({ name: gc.name, error: e.message }); continue; }
    perCase.push({ name: gc.name, ...scoreCase(predicted, gc.expected) });
  }
  return { perCase, summary: summarize(perCase) };
}

export function scoreCase(pred, exp) {
  const lineScore = scoreLines(pred.lineItems || [], exp.lineItems || []);
  const totalErr = pctError(pred.totals?.grandTotalCost, exp.totals?.grandTotalCost);
  const fields = scoreFields(pred, exp);
  return {
    linePrecision: lineScore.precision,
    lineRecall: lineScore.recall,
    lineF1: lineScore.f1,
    categoryAccuracy: lineScore.categoryAccuracy,
    totalPctError: totalErr,
    fieldAccuracy: fields.accuracy,
    matched: lineScore.matched,
    expectedCount: (exp.lineItems || []).length,
    predictedCount: (pred.lineItems || []).length,
  };
}

// Greedy match predicted→expected lines by SKU (exact), then fuzzy description.
function scoreLines(pred, exp) {
  const used = new Set();
  let matched = 0, categoryHits = 0;
  for (const p of pred) {
    let bestIdx = -1, bestScore = 0;
    exp.forEach((e, i) => {
      if (used.has(i)) return;
      const s = lineSimilarity(p, e);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    });
    if (bestIdx >= 0 && bestScore >= 0.6) {
      used.add(bestIdx); matched++;
      if (p.category === exp[bestIdx].category) categoryHits++;
    }
  }
  const precision = pred.length ? matched / pred.length : 0;
  const recall = exp.length ? matched / exp.length : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, matched,
    categoryAccuracy: matched ? categoryHits / matched : 0 };
}

function lineSimilarity(a, b) {
  if (a.sku && b.sku && norm(a.sku) === norm(b.sku)) return 1;
  if (a.mfgPartNumber && b.mfgPartNumber && norm(a.mfgPartNumber) === norm(b.mfgPartNumber)) return 1;
  const ds = tokenOverlap(a.description, b.description);
  // small boost when the extended cost is close — same item, OCR'd description
  const priceClose = pctError(a.extendedCost, b.extendedCost);
  return Math.min(1, ds + (priceClose != null && priceClose < 0.02 ? 0.15 : 0));
}

function scoreFields(pred, exp) {
  const checks = [
    eq(pred.source?.vendor, exp.source?.vendor),
    eq(pred.source?.quoteNumber, exp.source?.quoteNumber),
    eq(pred.source?.currency, exp.source?.currency),
    eq(pred.source?.validUntil, exp.source?.validUntil),
  ];
  const hits = checks.filter(Boolean).length;
  return { accuracy: hits / checks.length };
}

function summarize(perCase) {
  const ok = perCase.filter(c => !c.error);
  const avg = (f) => ok.length ? ok.reduce((s, c) => s + (c[f] || 0), 0) / ok.length : 0;
  return {
    cases: perCase.length,
    errored: perCase.length - ok.length,
    lineF1: round(avg("lineF1")),
    linePrecision: round(avg("linePrecision")),
    lineRecall: round(avg("lineRecall")),
    categoryAccuracy: round(avg("categoryAccuracy")),
    fieldAccuracy: round(avg("fieldAccuracy")),
    avgTotalPctError: round(avg("totalPctError")),
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────
function pctError(a, b) {
  const x = num(a, NaN), y = num(b, NaN);
  if (!isFinite(x) || !isFinite(y) || y === 0) return null;
  return Math.abs(x - y) / Math.abs(y);
}
function tokenOverlap(a, b) {
  const ta = tokens(a), tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  const hit = ta.filter(t => tb.has(t)).length;
  return hit / Math.max(ta.length, tb.size);
}
function tokens(s) { return norm(s).split(/\s+/).filter(t => t.length > 1); }
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
function eq(a, b) { return norm(a) === norm(b); }
function round(n) { return Math.round(n * 1000) / 1000; }
