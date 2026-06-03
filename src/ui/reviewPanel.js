// ─────────────────────────────────────────────────────────────────────────────
// reviewPanel.js — an embeddable, self-contained review/correction panel.
//
// Mount it anywhere (e.g. inside the CRM's quote-detail pane) to let a human
// correct an extracted StandardizedQuote at LINE-ITEM fidelity. This is the
// high-quality training signal the CRM's coarse buy-quote form (amount + category
// split) cannot produce — and the difference between a feedback loop that learns
// and one that records no-ops.
//
// No external CSS or globals: scoped inline styles (qrp- prefix) so it won't
// clash with the host app. Pure DOM; framework-agnostic.
//
// Usage:
//   import { mountReviewPanel } from ".../crmBridge.js";
//   const panel = mountReviewPanel(containerEl, {
//     quote,                       // the StandardizedQuote the extractor produced
//     onSave: (corrected) => { ... }, // called with the human-approved quote
//   });
//   // later: panel.getQuote(), panel.destroy()
// ─────────────────────────────────────────────────────────────────────────────

import { recomputeTotals, makeLineItem, CATEGORIES, CATEGORY_LABELS, num } from "../schema.js";

export function mountReviewPanel(container, opts = {}) {
  const el = typeof container === "string" ? document.querySelector(container) : container;
  if (!el) throw new Error("mountReviewPanel: container not found");
  if (!opts.quote) throw new Error("mountReviewPanel: opts.quote is required");

  const working = JSON.parse(JSON.stringify(opts.quote));
  recomputeTotals(working);
  const cur = () => working.source?.currency || "USD";
  const changed = () => opts.onChange && opts.onChange(working);

  el.innerHTML = `<div class="qrp">${styleTag()}
    <div class="qrp-hd">
      <span class="qrp-title">Review extracted quote</span>
      <span class="qrp-meta">${esc(working.meta?.extractor || "")}${working.meta?.model ? " · " + esc(working.meta.model) : ""}</span>
    </div>
    <div class="qrp-warn" data-warn></div>
    <div class="qrp-fields">
      ${field("vendor", "Vendor", working.source?.vendor)}
      ${field("quoteNumber", "Quote #", working.source?.quoteNumber)}
      ${field("validUntil", "Valid until", working.source?.validUntil, "date")}
      ${field("currency", "Currency", working.source?.currency)}
    </div>
    <table class="qrp-tbl">
      <thead><tr><th>#</th><th>SKU / MPN</th><th>Description</th><th>Type</th>
        <th class="qrp-r">Qty</th><th class="qrp-r">Unit cost</th><th class="qrp-r">Ext cost</th><th></th></tr></thead>
      <tbody data-body></tbody>
      <tfoot><tr><td colspan="6" class="qrp-r qrp-b">Grand total</td>
        <td class="qrp-r qrp-b" data-grand></td><td></td></tr></tfoot>
    </table>
    <div class="qrp-actions">
      <button class="qrp-btn" data-add>+ Add line</button>
      <span class="qrp-cats" data-cats></span>
      <span class="qrp-spacer"></span>
      <button class="qrp-btn qrp-primary" data-save>Save correction</button>
    </div>
  </div>`;

  // header field bindings
  el.querySelectorAll("[data-field]").forEach(inp => {
    inp.addEventListener("input", () => {
      const k = inp.dataset.field;
      working.source[k] = k === "currency" ? inp.value.toUpperCase().slice(0, 3) : inp.value;
      if (k === "currency") { renderTotals(); }
      changed();
    });
  });
  el.querySelector("[data-add]").addEventListener("click", () => {
    working.lineItems.push(makeLineItem({ description: "", quantity: 1, unitCost: 0, confidence: 1 }));
    recomputeTotals(working); renderRows(); changed();
  });
  el.querySelector("[data-save]").addEventListener("click", () => {
    recomputeTotals(working);
    opts.onSave && opts.onSave(working);
  });

  renderRows();
  renderWarnings();

  function renderRows() {
    const body = el.querySelector("[data-body]");
    body.innerHTML = working.lineItems.map((li, i) => `
      <tr data-i="${i}">
        <td class="qrp-mut">${i + 1}</td>
        <td><input data-li="sku" value="${esc(li.sku || li.mfgPartNumber)}"/></td>
        <td><input data-li="description" value="${esc(li.description)}"/></td>
        <td>${catSelect(li.category)}</td>
        <td class="qrp-r"><input data-li="quantity" type="number" min="0" value="${li.quantity}"/></td>
        <td class="qrp-r"><input data-li="unitCost" type="number" min="0" step="0.01" value="${li.unitCost}"/></td>
        <td class="qrp-r"><input data-li="extendedCost" type="number" min="0" step="0.01" value="${li.extendedCost}"/></td>
        <td><button class="qrp-x" data-del="${i}">×</button></td>
      </tr>`).join("");

    body.querySelectorAll("input,select").forEach(inp => inp.addEventListener("input", () => {
      const i = +inp.closest("tr").dataset.i, f = inp.dataset.li, li = working.lineItems[i];
      if (f === "quantity" || f === "unitCost" || f === "extendedCost") {
        li[f] = num(inp.value, 0);
        if (f === "quantity" || f === "unitCost") li.extendedCost = round2(li.unitCost * li.quantity);
        else if (li.quantity > 0) li.unitCost = round2(li.extendedCost / li.quantity);
        recomputeTotals(working); renderTotals();
      } else { li[f] = inp.value; }
      changed();
    }));
    body.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      working.lineItems.splice(+b.dataset.del, 1);
      recomputeTotals(working); renderRows(); changed();
    }));
    renderTotals();
  }

  function renderTotals() {
    el.querySelector("[data-grand]").textContent = money(working.totals.grandTotalCost, cur());
    el.querySelector("[data-cats]").innerHTML = CATEGORIES
      .filter(c => working.categoryTotals[c]?.cost)
      .map(c => `<span class="qrp-pill qrp-${c}">${CATEGORY_LABELS[c].split(" ")[0]} ${money(working.categoryTotals[c].cost, cur())}</span>`)
      .join(" ");
  }
  function renderWarnings() {
    const w = working.meta?.warnings || [];
    el.querySelector("[data-warn]").innerHTML = w.length
      ? `⚠ ${w.length} to check: ${w.map(esc).join(" · ")}` : "";
    el.querySelector("[data-warn]").style.display = w.length ? "block" : "none";
  }

  return {
    getQuote() { recomputeTotals(working); return working; },
    destroy() { el.innerHTML = ""; },
  };
}

// ── render helpers ──────────────────────────────────────────────────────────────
function field(key, label, val, type = "text") {
  return `<label class="qrp-fld">${esc(label)}
    <input data-field="${key}" type="${type}" value="${esc(val || "")}"/></label>`;
}
function catSelect(sel) {
  return `<select data-li="category" class="qrp-pill qrp-${sel}">${
    CATEGORIES.map(c => `<option value="${c}" ${c === sel ? "selected" : ""}>${CATEGORY_LABELS[c].split(" ")[0]}</option>`).join("")
  }</select>`;
}
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function money(n, c) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: c }).format(num(n, 0)); }
  catch { return `${c} ${num(n, 0).toFixed(2)}`; }
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }

function styleTag() {
  return `<style>
  .qrp{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#172b4d}
  .qrp-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
  .qrp-title{font-weight:800;font-size:13px}.qrp-meta{font-size:11px;color:#5e6c84}
  .qrp-warn{background:#fffae6;border:1px solid #ffe380;border-radius:5px;padding:6px 9px;font-size:12px;color:#974f0c;margin-bottom:8px}
  .qrp-fields{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
  .qrp-fld{display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;color:#5e6c84}
  .qrp-fld input{font:12px inherit;padding:5px 7px;border:1px solid #dfe1e6;border-radius:5px;color:#172b4d}
  .qrp-tbl{width:100%;border-collapse:collapse;font-size:12px}
  .qrp-tbl th{background:#f4f5f7;text-align:left;padding:6px;font-size:10px;color:#5e6c84;text-transform:uppercase;border-bottom:2px solid #dfe1e6}
  .qrp-tbl td{padding:4px 6px;border-bottom:1px solid #eef0f2}
  .qrp-tbl input,.qrp-tbl select{width:100%;padding:3px 5px;font:12px inherit;border:1px solid #dfe1e6;border-radius:4px}
  .qrp-r{text-align:right}.qrp-b{font-weight:800}.qrp-mut{color:#5e6c84}
  .qrp-x{border:1px solid #dfe1e6;background:#fff;border-radius:4px;cursor:pointer;padding:2px 7px;color:#de350b}
  .qrp-actions{display:flex;align-items:center;gap:10px;margin-top:10px}
  .qrp-spacer{flex:1}
  .qrp-btn{font:12px inherit;font-weight:600;padding:6px 13px;border:1px solid #dfe1e6;background:#fff;border-radius:6px;cursor:pointer}
  .qrp-primary{background:#0052cc;color:#fff;border-color:#0052cc}
  .qrp-pill{font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px}
  .qrp-hw{background:#e8f0fe;color:#1a73e8}.qrp-sw{background:#e6f9f0;color:#137333}
  .qrp-ps{background:#fff3e0;color:#e65100}.qrp-other{background:#eee;color:#666}
  </style>`;
}
