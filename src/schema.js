// ─────────────────────────────────────────────────────────────────────────────
// StandardizedQuote — the canonical, normalized representation of a reseller /
// distributor quote. This is the "perfect standardized template" the whole POC
// revolves around: every extractor must produce it, the review UI edits it, the
// eval harness scores against it, the customer template renders from it, and the
// CRM adapter maps it onto the existing CRM buyQuote object.
//
// This module is intentionally environment-neutral (no DOM, no Node APIs) so it
// can be imported unchanged by the browser app AND the serverless proxy. It is
// the single source of truth for the shape — keep it that way.
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = "1.0";

/** Line-item categories. Mirrors the CRM's hw/sw/ps split, plus "other". */
export const CATEGORIES = ["hw", "sw", "ps", "other"];

export const CATEGORY_LABELS = {
  hw: "Hardware",
  sw: "Software / Licensing",
  ps: "Professional Services",
  other: "Other",
};

/** A single parsed line item from a quote. */
export function makeLineItem(partial = {}) {
  return {
    lineNo: partial.lineNo ?? null,
    sku: partial.sku ?? "",                 // vendor/distributor SKU
    mfgPartNumber: partial.mfgPartNumber ?? "", // manufacturer part no. (MPN)
    description: partial.description ?? "",
    category: CATEGORIES.includes(partial.category) ? partial.category : "other",
    quantity: num(partial.quantity, 1),
    unit: partial.unit ?? "ea",
    unitCost: num(partial.unitCost, 0),      // what WE pay the reseller (buy)
    extendedCost: partial.extendedCost != null
      ? num(partial.extendedCost, 0)
      : round2(num(partial.unitCost, 0) * num(partial.quantity, 1)),
    // Sell side is optional at parse time — usually derived later via markup.
    unitPrice: partial.unitPrice != null ? num(partial.unitPrice, 0) : null,
    extendedPrice: partial.extendedPrice != null ? num(partial.extendedPrice, 0) : null,
    // Confidence (0..1) + where in the source it came from, for the feedback loop.
    confidence: clamp01(num(partial.confidence, 1)),
    sourceRef: partial.sourceRef ?? "",      // e.g. "p2/row14" or "Sheet1!B7"
  };
}

/** Construct a complete StandardizedQuote, filling sensible defaults. */
export function makeStandardizedQuote(partial = {}) {
  const lineItems = (partial.lineItems || []).map(makeLineItem);
  const q = {
    schemaVersion: SCHEMA_VERSION,
    source: {
      vendor: partial.source?.vendor ?? "",
      vendorType: ["reseller", "distributor", "unknown"].includes(partial.source?.vendorType)
        ? partial.source.vendorType : "unknown",
      quoteNumber: partial.source?.quoteNumber ?? "",
      quoteDate: partial.source?.quoteDate ?? "",     // ISO yyyy-mm-dd if known
      validUntil: partial.source?.validUntil ?? "",   // ISO yyyy-mm-dd if known
      currency: partial.source?.currency ?? "USD",
      contact: partial.source?.contact ?? "",
      fileName: partial.source?.fileName ?? "",
    },
    customer: {
      name: partial.customer?.name ?? "",   // filled by us, not the reseller
      ref: partial.customer?.ref ?? "",
    },
    lineItems,
    totals: {
      subtotalCost: null,
      tax: num(partial.totals?.tax, 0),
      shipping: num(partial.totals?.shipping, 0),
      grandTotalCost: null,
      currency: partial.source?.currency ?? partial.totals?.currency ?? "USD",
    },
    categoryTotals: {},        // filled by recomputeTotals
    meta: {
      extractor: partial.meta?.extractor ?? "unknown",
      model: partial.meta?.model ?? "",
      promptVersion: partial.meta?.promptVersion ?? "",
      extractedAt: partial.meta?.extractedAt ?? new Date().toISOString(),
      durationMs: partial.meta?.durationMs ?? null,
      warnings: partial.meta?.warnings ?? [],
      overallConfidence: partial.meta?.overallConfidence ?? null,
    },
  };
  return recomputeTotals(q);
}

/**
 * Recompute totals + per-category rollups from line items. Pure: returns the
 * same object (mutated) for convenience. Always run this after editing items.
 */
export function recomputeTotals(q) {
  const cat = { hw: { cost: 0, price: 0, count: 0 }, sw: { cost: 0, price: 0, count: 0 },
                ps: { cost: 0, price: 0, count: 0 }, other: { cost: 0, price: 0, count: 0 } };
  let subtotalCost = 0;
  for (const li of q.lineItems) {
    const ext = li.extendedCost != null ? li.extendedCost : round2(li.unitCost * li.quantity);
    li.extendedCost = round2(ext);
    subtotalCost += li.extendedCost;
    const c = cat[li.category] || cat.other;
    c.cost = round2(c.cost + li.extendedCost);
    if (li.extendedPrice != null) c.price = round2(c.price + li.extendedPrice);
    c.count += 1;
  }
  q.totals.subtotalCost = round2(subtotalCost);
  q.totals.grandTotalCost = round2(subtotalCost + num(q.totals.tax, 0) + num(q.totals.shipping, 0));
  q.categoryTotals = cat;
  return q;
}

/**
 * Validate a StandardizedQuote. Returns { ok, errors:[], warnings:[] }.
 * Warnings don't block use (a POC should be forgiving) but surface in the UI
 * and feed the feedback loop (e.g. "extracted total != sum of lines").
 */
export function validateQuote(q) {
  const errors = [];
  const warnings = [];
  if (!q || typeof q !== "object") return { ok: false, errors: ["not an object"], warnings };
  if (q.schemaVersion !== SCHEMA_VERSION)
    warnings.push(`schemaVersion ${q.schemaVersion} != ${SCHEMA_VERSION}`);
  if (!Array.isArray(q.lineItems) || q.lineItems.length === 0)
    errors.push("no line items extracted");
  (q.lineItems || []).forEach((li, i) => {
    if (!li.description && !li.sku && !li.mfgPartNumber)
      warnings.push(`line ${i + 1}: no description/SKU/MPN`);
    if (!(li.quantity > 0)) warnings.push(`line ${i + 1}: quantity not positive`);
    if (!CATEGORIES.includes(li.category)) warnings.push(`line ${i + 1}: bad category`);
    const recomputed = round2(li.unitCost * li.quantity);
    if (li.extendedCost != null && Math.abs(li.extendedCost - recomputed) > 0.02)
      warnings.push(`line ${i + 1}: extendedCost ${li.extendedCost} != unitCost×qty ${recomputed}`);
  });
  // Reconcile line sum vs stated grand total when both present.
  if (q.totals?.grandTotalCost != null && q.lineItems?.length) {
    const sum = q.lineItems.reduce((s, li) => s + (li.extendedCost || 0), 0)
      + num(q.totals.tax, 0) + num(q.totals.shipping, 0);
    if (Math.abs(round2(sum) - q.totals.grandTotalCost) > Math.max(1, q.totals.grandTotalCost * 0.01))
      warnings.push(`grand total ${q.totals.grandTotalCost} != sum of lines ${round2(sum)}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ── Small pure helpers (kept local so this file has zero dependencies) ────────
export function num(v, dflt = 0) {
  if (typeof v === "number") return isFinite(v) ? v : dflt;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : dflt;
  }
  return dflt;
}
export function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
export function clamp01(n) { return Math.max(0, Math.min(1, n)); }

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA_PROMPT — the exact JSON contract we hand the LLM. Lives here so the
// schema and the prompt instructions can never drift apart. The proxy imports
// this and embeds it in the system prompt.
// ─────────────────────────────────────────────────────────────────────────────
export const SCHEMA_PROMPT = `Return ONLY a single JSON object (no prose, no markdown fences) matching exactly:

{
  "source": {
    "vendor": "string — reseller/distributor company name on the quote",
    "vendorType": "reseller | distributor | unknown",
    "quoteNumber": "string — their quote/reference number, else \\"\\"",
    "quoteDate": "yyyy-mm-dd or \\"\\"",
    "validUntil": "yyyy-mm-dd (quote expiry) or \\"\\"",
    "currency": "ISO 4217 code, e.g. USD, GBP, EUR — default USD",
    "contact": "rep name/email if present, else \\"\\""
  },
  "lineItems": [
    {
      "sku": "vendor/distributor part number, else \\"\\"",
      "mfgPartNumber": "manufacturer part number (MPN), else \\"\\"",
      "description": "full item description",
      "category": "hw | sw | ps | other  (hw=hardware/physical, sw=software/licenses/subscriptions/support, ps=professional services/installation/labour, other=freight/misc)",
      "quantity": number,
      "unit": "ea | license | hour | day | month | year ...",
      "unitCost": number,        // per-unit price WE pay the reseller (ex-tax)
      "extendedCost": number,    // unitCost * quantity (ex-tax)
      "confidence": number,      // 0..1, your confidence in THIS line
      "sourceRef": "where you found it, e.g. \\"p2 row 14\\" or \\"Sheet1 row 7\\""
    }
  ],
  "totals": {
    "tax": number,        // total tax/VAT, else 0
    "shipping": number,   // freight/shipping, else 0
    "grandTotalCost": number   // the quote's stated grand total (incl tax+shipping)
  },
  "overallConfidence": number,  // 0..1 across the whole extraction
  "warnings": ["short strings describing anything ambiguous or unreadable"]
}

Rules:
- Extract EVERY line item, including bundled/child SKUs, freight, and support/warranty lines.
- Numbers must be plain numbers (no currency symbols, no thousands separators).
- If a value is genuinely absent, use "" for strings, 0 for numbers — never invent SKUs or prices.
- Categorize by what the item IS, not where it sits on the page.
- Prefer the quote's own stated grand total for totals.grandTotalCost; if absent, sum the lines.`;
