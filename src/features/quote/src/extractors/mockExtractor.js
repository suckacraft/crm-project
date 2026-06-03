// ─────────────────────────────────────────────────────────────────────────────
// MockExtractor — a deterministic, zero-config, offline extractor.
//
// Why it exists:
//  • The whole app (ingest → review → template → CRM mapping → eval) runs with
//    NO API key, so the team can demo and develop the pipeline immediately.
//  • It is the baseline the eval harness scores the LLM against — "better
//    inferencing over time" only means something relative to a baseline.
//
// It is a genuine (if naive) parser: it finds the most table-like block in the
// document, guesses which columns are SKU / description / qty / price using
// header keywords and value shapes, and classifies each row with the shared
// category heuristic. No magic, fully inspectable.
// ─────────────────────────────────────────────────────────────────────────────

import { registerExtractor } from "./base.js";
import { normalizeExtraction } from "../normalize.js";
import { num } from "../schema.js";

const HEADER_HINTS = {
  sku: [/^sku$/i, /part\s*(no|number|#)/i, /^item\s*(no|code)?$/i, /^code$/i, /mfg/i, /mpn/i],
  description: [/desc/i, /description/i, /product/i, /detail/i, /^item$/i],
  quantity: [/^qty$/i, /quantity/i, /^units?$/i],
  unitCost: [/unit\s*(price|cost)/i, /^(price|cost|rate)$/i, /each/i, /list/i],
  extendedCost: [/ext(ended)?/i, /line\s*(total|price)/i, /^(total|amount|subtotal)$/i],
};

export const mockExtractor = {
  id: "mock",
  label: "Mock (offline, no key)",
  needsKey: false,
  async extract(doc) {
    const t0 = now();
    const table = pickTable(doc);
    const items = table ? rowsToItems(table) : looseLines(doc.text || "");
    const meta = parseMeta(doc.text || "", doc.fileName || "");
    const raw = {
      source: meta.source,
      lineItems: items,
      totals: meta.totals,
      overallConfidence: items.length ? 0.55 : 0.1, // honest: a heuristic, not an LLM
      warnings: items.length ? [] : ["mock extractor found no table-like content"],
    };
    return normalizeExtraction(raw, {
      extractor: "mock", model: "heuristic-v1", promptVersion: "heuristic-v1",
      durationMs: Math.round(now() - t0), fileName: doc.fileName,
    });
  },
};
registerExtractor(mockExtractor);

// ── table selection + column mapping ──────────────────────────────────────────
function pickTable(doc) {
  const tables = (doc.tables || []).filter(t => t.rows && t.rows.length >= 2);
  if (!tables.length) return null;
  // Choose the widest, tallest table — most likely the line-item grid.
  return tables.sort((a, b) =>
    (b.rows.length * (b.rows[0]?.length || 0)) - (a.rows.length * (a.rows[0]?.length || 0)))[0];
}

function mapColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, i) => {
    const h = String(cell || "").trim();
    for (const [field, hints] of Object.entries(HEADER_HINTS)) {
      if (map[field] != null) continue;
      if (hints.some(re => re.test(h))) { map[field] = i; break; }
    }
  });
  return map;
}

function rowsToItems(table) {
  const rows = table.rows;
  // Detect a header row in the first 3 rows: the one whose cells best match hints.
  let headerIdx = 0, best = -1;
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const m = mapColumns(rows[i]);
    const score = Object.keys(m).length;
    if (score > best) { best = score; headerIdx = i; }
  }
  const map = mapColumns(rows[headerIdx]);
  const hasMap = Object.keys(map).length >= 2;

  const items = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => String(c ?? "").trim() === "")) continue;
    const get = (field) => map[field] != null ? row[map[field]] : undefined;

    let description, sku, qty, unitCost, extCost;
    if (hasMap) {
      description = get("description");
      sku = get("sku");
      qty = num(get("quantity"), NaN);
      unitCost = num(get("unitCost"), NaN);
      extCost = num(get("extendedCost"), NaN);
    } else {
      // No usable header: infer by value shape — text cell = description,
      // numeric cells = qty (smallest int) and money (largest).
      const text = row.filter(c => isNaN(num(c, NaN)) && String(c).trim()).join(" ");
      const nums = row.map(c => num(c, NaN)).filter(isFinite);
      description = text;
      qty = nums.length ? Math.min(...nums) : NaN;
      extCost = nums.length ? Math.max(...nums) : NaN;
    }
    if ((!description || !String(description).trim()) && !sku) continue;

    const q = isFinite(qty) && qty > 0 ? qty : 1;
    let uc = isFinite(unitCost) ? unitCost : (isFinite(extCost) ? extCost / q : NaN);
    let ec = isFinite(extCost) ? extCost : (isFinite(uc) ? uc * q : NaN);
    if (!isFinite(uc) && !isFinite(ec)) continue; // no price → not a line item

    items.push({
      sku: sku ? String(sku).trim() : "",
      description: description ? String(description).trim() : "",
      quantity: q,
      unitCost: isFinite(uc) ? uc : 0,
      extendedCost: isFinite(ec) ? ec : 0,
      confidence: hasMap ? 0.6 : 0.35,
      sourceRef: `${table.name || "table"} row ${r + 1}`,
    });
  }
  return items;
}

// Fallback for free-text quotes (email body): lines like "2 x Widget  $1,200".
function looseLines(text) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*[x×]?\s+(.+?)\s+[$£€]?\s*([\d,]+(?:\.\d{1,2})?)\s*$/);
    if (m) {
      const qty = num(m[1], 1) || 1;
      const ext = num(m[3], 0);
      items.push({ description: m[2].trim(), quantity: qty, extendedCost: ext, unitCost: ext / qty,
        confidence: 0.3, sourceRef: "email line" });
    }
  }
  return items;
}

// ── lightweight metadata scrape ───────────────────────────────────────────────
function parseMeta(text, fileName) {
  const quoteNumber = first(text, [/quote\s*(?:no\.?|number|#|ref)\s*[:#]?\s*([A-Z0-9\-\/]{3,})/i,
    /\bQ-?\d{4,}\b/]);
  const validUntil = first(text, [/valid\s*(?:until|through|to)\s*[:]?\s*([A-Za-z0-9 ,\/\-]{6,20})/i,
    /expir(?:es|y)\s*[:]?\s*([A-Za-z0-9 ,\/\-]{6,20})/i]);
  const currency = /£|\bGBP\b/.test(text) ? "GBP" : /€|\bEUR\b/.test(text) ? "EUR" : "USD";
  const grand = first(text, [/grand\s*total\s*[:]?\s*[$£€]?\s*([\d,]+\.?\d*)/i,
    /total\s*(?:due|amount)?\s*[:]?\s*[$£€]?\s*([\d,]+\.?\d*)/i]);
  const vendor = (fileName.replace(/\.[^.]+$/, "").split(/[-_]/)[0] || "").trim();
  return {
    source: { vendor, quoteNumber: quoteNumber || "", validUntil: validUntil || "", currency },
    totals: { grandTotalCost: grand ? num(grand, 0) : 0 },
  };
}
function first(text, regexes) {
  for (const re of regexes) { const m = text.match(re); if (m) return (m[1] || m[0]).trim(); }
  return "";
}
function now() { return (typeof performance !== "undefined" ? performance.now() : Date.now()); }
