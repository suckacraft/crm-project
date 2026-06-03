// ─────────────────────────────────────────────────────────────────────────────
// template.js — render a StandardizedQuote into the customer-facing standardized
// quote. This is the "perfect standardized template that goes to customers":
// vendor-neutral, consistently formatted, with our sell pricing derived from a
// markup applied to the reseller cost.
//
// applyMarkup() is pure (returns a new quote with sell prices); renderCustomer-
// QuoteHtml() returns a self-contained HTML string suitable for print/PDF/email.
// ─────────────────────────────────────────────────────────────────────────────

import { recomputeTotals, round2, num, CATEGORY_LABELS } from "./schema.js";

/**
 * Derive customer sell pricing from reseller cost.
 * @param markupPct  e.g. 20 → sell = cost * 1.20. Can be a number (flat) or a
 *                   map by category, e.g. { hw:15, sw:10, ps:35, other:0 }.
 */
export function applyMarkup(quote, markupPct = 20) {
  const q = JSON.parse(JSON.stringify(quote)); // don't mutate the source
  const rate = (cat) => typeof markupPct === "number" ? markupPct : num(markupPct[cat], 0);
  for (const li of q.lineItems) {
    const m = 1 + rate(li.category) / 100;
    li.unitPrice = round2(li.unitCost * m);
    li.extendedPrice = round2(li.extendedCost * m);
  }
  recomputeTotals(q);
  // grand total price (incl. same tax/shipping pass-through)
  const subPrice = q.lineItems.reduce((s, li) => s + (li.extendedPrice || 0), 0);
  q.totals.subtotalPrice = round2(subPrice);
  q.totals.grandTotalPrice = round2(subPrice + num(q.totals.tax, 0) + num(q.totals.shipping, 0));
  return q;
}

export function renderCustomerQuoteHtml(quote, opts = {}) {
  const company = opts.companyName || "Your Company";
  const cur = quote.totals?.currency || quote.source?.currency || "USD";
  const money = (n) => fmtMoney(n, cur);
  const today = new Date().toISOString().slice(0, 10);
  const hasSell = quote.lineItems.some(li => li.extendedPrice != null);

  const rows = quote.lineItems.map((li, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(li.sku || li.mfgPartNumber || "")}</td>
      <td>${esc(li.description)}</td>
      <td class="c">${tag(li.category)}</td>
      <td class="r">${li.quantity}</td>
      <td class="r">${money(hasSell ? li.unitPrice : li.unitCost)}</td>
      <td class="r">${money(hasSell ? li.extendedPrice : li.extendedCost)}</td>
    </tr>`).join("");

  const grand = hasSell ? quote.totals.grandTotalPrice : quote.totals.grandTotalCost;
  const sub = hasSell ? quote.totals.subtotalPrice : quote.totals.subtotalCost;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Quote ${esc(quote.source?.quoteNumber || "")}</title>
<style>
  body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#172b4d;max-width:820px;margin:24px auto;padding:0 20px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0052cc;padding-bottom:14px}
  h1{font-size:22px;margin:0;color:#0052cc}.muted{color:#5e6c84}
  .meta{font-size:12px;text-align:right}
  table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}
  th{background:#f4f5f7;text-align:left;padding:8px;border-bottom:2px solid #dfe1e6;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#5e6c84}
  td{padding:8px;border-bottom:1px solid #eef0f2;vertical-align:top}
  .r{text-align:right;white-space:nowrap}.c{text-align:center}
  tfoot td{font-weight:700;border-top:2px solid #dfe1e6}
  .pill{font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;background:#e8f0fe;color:#1a73e8}
  .totals{margin-top:14px;margin-left:auto;width:280px}
  .totals div{display:flex;justify-content:space-between;padding:4px 0}
  .grand{font-size:16px;font-weight:800;border-top:2px solid #0052cc;margin-top:6px;padding-top:8px;color:#0052cc}
  .foot{margin-top:28px;font-size:11px;color:#5e6c84;border-top:1px solid #eef0f2;padding-top:10px}
</style></head><body>
  <div class="head">
    <div><h1>${esc(company)}</h1><div class="muted">Quotation</div></div>
    <div class="meta">
      <div><strong>Quote #:</strong> ${esc(quote.source?.quoteNumber || "—")}</div>
      <div><strong>Date:</strong> ${today}</div>
      ${quote.source?.validUntil ? `<div><strong>Valid until:</strong> ${esc(quote.source.validUntil)}</div>` : ""}
      <div><strong>Currency:</strong> ${esc(cur)}</div>
    </div>
  </div>
  ${quote.customer?.name ? `<p style="margin-top:14px"><strong>Prepared for:</strong> ${esc(quote.customer.name)}</p>` : ""}
  <table>
    <thead><tr><th>#</th><th>Part No.</th><th>Description</th><th>Type</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${money(sub)}</span></div>
    ${num(quote.totals.shipping) ? `<div><span>Shipping</span><span>${money(quote.totals.shipping)}</span></div>` : ""}
    ${num(quote.totals.tax) ? `<div><span>Tax</span><span>${money(quote.totals.tax)}</span></div>` : ""}
    <div class="grand"><span>Total</span><span>${money(grand)}</span></div>
  </div>
  <div class="foot">
    Generated from ${esc(quote.source?.vendor || "supplier")} quote ${esc(quote.source?.quoteNumber || "")}
    via the Quote Parsing POC. ${hasSell ? "Customer pricing shown." : "Cost pricing shown (no markup applied)."}
    Please review before issuing.
  </div>
</body></html>`;
}

function tag(cat) {
  return `<span class="pill">${esc((CATEGORY_LABELS[cat] || cat).split(" ")[0])}</span>`;
}
function fmtMoney(n, cur) {
  const v = num(n, 0);
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur }).format(v); }
  catch { return `${cur} ${v.toFixed(2)}`; }
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
