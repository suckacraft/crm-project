// ─────────────────────────────────────────────────────────────────────────────
// normalize.js — turn loose, possibly-messy extractor output (from an LLM, a
// rules engine, or the mock) into a clean, validated StandardizedQuote.
//
// Pure / environment-neutral: imported by both the browser app and the proxy so
// the LLM's raw JSON gets the same post-processing wherever extraction runs.
// ─────────────────────────────────────────────────────────────────────────────

import { makeStandardizedQuote, recomputeTotals, validateQuote, num, CATEGORIES } from "./schema.js";

/**
 * Normalize raw extractor output into a StandardizedQuote.
 * @param raw   loose object (e.g. parsed LLM JSON) — fields may be missing/dirty
 * @param meta  { extractor, model, durationMs, fileName }
 */
export function normalizeExtraction(raw, meta = {}) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const items = Array.isArray(safe.lineItems) ? safe.lineItems : [];

  const lineItems = items.map((it, idx) => {
    const quantity = num(it.quantity, 1) || 1;
    const unitCost = num(it.unitCost, NaN);
    const extendedCost = num(it.extendedCost, NaN);
    // Repair missing unit/extended cost from whichever we have.
    let uc = isFinite(unitCost) ? unitCost : (isFinite(extendedCost) ? extendedCost / quantity : 0);
    let ec = isFinite(extendedCost) ? extendedCost : uc * quantity;
    const category = CATEGORIES.includes(it.category)
      ? it.category
      : inferCategory(`${it.description || ""} ${it.sku || ""} ${it.mfgPartNumber || ""}`, it.unit);
    return {
      lineNo: it.lineNo ?? idx + 1,
      sku: clean(it.sku),
      mfgPartNumber: clean(it.mfgPartNumber),
      description: clean(it.description),
      category,
      quantity,
      unit: clean(it.unit) || "ea",
      unitCost: round2(uc),
      extendedCost: round2(ec),
      unitPrice: it.unitPrice != null ? round2(num(it.unitPrice)) : null,
      extendedPrice: it.extendedPrice != null ? round2(num(it.extendedPrice)) : null,
      confidence: clampConf(it.confidence),
      sourceRef: clean(it.sourceRef),
    };
  });

  const q = makeStandardizedQuote({
    source: {
      vendor: clean(safe.source?.vendor),
      vendorType: safe.source?.vendorType,
      quoteNumber: clean(safe.source?.quoteNumber),
      quoteDate: isoDate(safe.source?.quoteDate),
      validUntil: isoDate(safe.source?.validUntil),
      currency: (clean(safe.source?.currency) || "USD").toUpperCase().slice(0, 3),
      contact: clean(safe.source?.contact),
      fileName: meta.fileName || "",
    },
    lineItems,
    totals: {
      tax: num(safe.totals?.tax, 0),
      shipping: num(safe.totals?.shipping, 0),
    },
    meta: {
      extractor: meta.extractor || "unknown",
      model: meta.model || "",
      promptVersion: meta.promptVersion || "",
      durationMs: meta.durationMs ?? null,
      overallConfidence: clampConf(safe.overallConfidence),
      warnings: Array.isArray(safe.warnings) ? safe.warnings.map(String) : [],
    },
  });

  // Respect a stated grand total when the model gave one; recompute the rest.
  const statedTotal = num(safe.totals?.grandTotalCost, NaN);
  recomputeTotals(q);
  if (isFinite(statedTotal) && statedTotal > 0) {
    q.totals.grandTotalCost = round2(statedTotal);
  }

  // Fold validation warnings into meta so the review UI + feedback loop see them.
  const v = validateQuote(q);
  q.meta.warnings = dedupe([...q.meta.warnings, ...v.warnings, ...v.errors]);
  return q;
}

// ── Category inference ────────────────────────────────────────────────────────
// Keyword heuristic used as a fallback when the extractor doesn't classify a
// line, and as the core of the zero-config MockExtractor. Deliberately simple
// and inspectable — the LLM does the heavy lifting in production.
const RULES = [
  { cat: "ps", re: /\b(install|installation|deploy|deployment|professional services|consult|labou?r|onboard|training|implementation|setup|engineer(ing)?|managed service|configuration|day rate|sow)\b/i },
  { cat: "sw", re: /\b(licen[cs]e|subscription|software|saas|m365|office 365|windows server|cal|antivirus|firmware|support|warranty|maintenance|renewal|cloud|virtual|per[- ]user|per[- ]seat|365|adobe|veeam)\b/i },
  { cat: "hw", re: /\b(server|laptop|desktop|switch|router|firewall|access point|ap\b|cable|sfp|ssd|hdd|nvme|ram|memory|gpu|cpu|monitor|workstation|chassis|rack|ups|nas|disk|drive|adapter|module|appliance|poe|compute|node|blade|enclosure|controller|array|transceiver|dimm|processor)\b/i },
  { cat: "other", re: /\b(freight|shipping|delivery|carriage|handling|misc|recycling|environmental fee)\b/i },
];
export function inferCategory(text = "", unit = "") {
  const u = String(unit || "").toLowerCase();
  if (/\b(hour|day|hr|hrs|days)\b/.test(u)) return "ps";
  if (/\b(licen[cs]e|seat|user|month|year|sub)\b/.test(u)) return "sw";
  for (const r of RULES) if (r.re.test(text)) return r.cat;
  return "other";
}

// ── tiny helpers ──────────────────────────────────────────────────────────────
function clean(v) { return v == null ? "" : String(v).trim(); }
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function clampConf(c) { const n = num(c, 1); return Math.max(0, Math.min(1, n)); }
function dedupe(arr) { return [...new Set(arr.filter(Boolean))]; }
function isoDate(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}
