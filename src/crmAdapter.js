// ─────────────────────────────────────────────────────────────────────────────
// crmAdapter.js — the integration seam with the existing CRM (crm-project).
//
// The CRM stores quotes against an opportunity as a "buyQuote" object and splits
// money into hw/sw/ps categories (see openQuoteForm / getOppFileData in the CRM
// index.html). This maps a StandardizedQuote onto exactly that shape, so dropping
// the parser into the CRM is a function call — not a re-model.
//
// CRM buyQuote shape (from crm-project):
//   { id, name, type, size, addedAt, expiryDate, amount, dataUrl,
//     categories:[{ type:'hw'|'sw'|'ps', amount }] }
// We additionally attach `parsed` (the full StandardizedQuote) and a richer
// `lineItems` array — extra fields the CRM ignores today but can adopt later.
// ─────────────────────────────────────────────────────────────────────────────

import { round2 } from "./schema.js";

/**
 * @param quote     StandardizedQuote
 * @param fileMeta  { id, name, type, size, dataUrl } from the uploaded file
 */
export function toCrmBuyQuote(quote, fileMeta = {}) {
  const ct = quote.categoryTotals || {};
  // CRM only knows hw/sw/ps — fold "other" into hw (closest to materials), but
  // keep the true breakdown in `parsed` for when the CRM gains an "other" lane.
  const categories = ["hw", "sw", "ps"]
    .map(type => ({ type, amount: round2((ct[type]?.cost || 0) + (type === "hw" ? (ct.other?.cost || 0) : 0)) }))
    .filter(c => c.amount > 0);

  return {
    id: fileMeta.id || uid(),
    name: fileMeta.name || quote.source?.fileName || "quote",
    type: fileMeta.type || "",
    size: fileMeta.size || 0,
    addedAt: new Date().toISOString(),
    expiryDate: quote.source?.validUntil || null,
    amount: quote.totals?.grandTotalCost ?? null,
    dataUrl: fileMeta.dataUrl || "",
    categories,
    // ── richer, parser-provided fields (additive; CRM-safe) ──
    parsed: quote,
    lineItems: quote.lineItems,
    vendor: quote.source?.vendor || "",
    quoteNumber: quote.source?.quoteNumber || "",
    currency: quote.source?.currency || "USD",
    extractedBy: quote.meta?.extractor || "",
  };
}

/**
 * Map onto the CRM opportunity's line-item calculator shape
 *   lineItems:{ hw:{sell,buy}, sw:{sell,buy}, ps:{enabled,units,...} }
 * Useful to pre-fill the deal's buy figures straight from a parsed quote.
 */
export function toCrmLineItems(quote) {
  const ct = quote.categoryTotals || {};
  return {
    hw: { sell: 0, buy: round2((ct.hw?.cost || 0) + (ct.other?.cost || 0)) },
    sw: { sell: 0, buy: round2(ct.sw?.cost || 0) },
    ps: { enabled: (ct.ps?.cost || 0) > 0, units: 1, unitType: "days",
          sellRate: 0, buyRate: round2(ct.ps?.cost || 0) },
  };
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
