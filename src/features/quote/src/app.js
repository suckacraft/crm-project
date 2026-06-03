// ─────────────────────────────────────────────────────────────────────────────
// app.js — UI controller. Wires the pipeline together:
//   upload → ingest → extract → review/correct → save feedback
//   → generate customer template / map to CRM buyQuote
//   plus the Feedback and Eval tabs.
// Importing the extractor modules registers them in the registry.
// ─────────────────────────────────────────────────────────────────────────────

import { ingestFile } from "./ingest.js";
import { listExtractors, getExtractor } from "./extractors/base.js";
import "./extractors/mockExtractor.js";
import "./extractors/llmExtractor.js";
import { recomputeTotals, makeLineItem, makeStandardizedQuote, CATEGORIES, CATEGORY_LABELS, num } from "./schema.js";
import { recordCorrection, getFeedback, clearFeedback, exportJsonl, importJsonl, promoteToGolden, getGolden } from "./feedback.js";
import { fullSync, rehydrate } from "./dataset/sync.js";
import { runEval } from "./evaluate.js";
import { applyMarkup, renderCustomerQuoteHtml } from "./template.js";
import { toCrmBuyQuote } from "./crmAdapter.js";
import { getSettings, saveSettings, KEYS, ls, ss } from "./storage.js";
import { SAMPLES, sampleToFile } from "./samples.js";

const $ = (id) => document.getElementById(id);
const state = { doc: null, predicted: null, working: null, fileMeta: null };

// ── boot ──────────────────────────────────────────────────────────────────────
init();
function init() {
  wireTabs();
  populateExtractorSelects();
  loadSettingsForm();
  wireUpload();
  wireReviewButtons();
  wireFeedbackTab();
  wireEvalTab();
  wireSettings();
  renderSamplesList();
  // Best-effort: rehydrate the local corpus from the durable store on boot, so a
  // fresh/wiped browser or a new product instance recovers all learnings.
  rehydrate().then(r => { if (r && !r.skipped) renderFeedbackList(); }).catch(() => {});
}

// ── tabs ──────────────────────────────────────────────────────────────────────
function wireTabs() {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    $(`panel-${t.dataset.tab}`).classList.add("active");
    if (t.dataset.tab === "feedback") renderFeedbackList();
  }));
}

function populateExtractorSelects() {
  const opts = listExtractors().map(e => `<option value="${e.id}">${e.label}</option>`).join("");
  ["sel-extractor", "set-extractor", "eval-extractor"].forEach(id => { if ($(id)) $(id).innerHTML = opts; });
  const s = getSettings();
  $("sel-extractor").value = s.extractorId;
  $("eval-extractor").value = s.extractorId;
  updateExtractorNote();
  $("sel-extractor").addEventListener("change", updateExtractorNote);
}
function updateExtractorNote() {
  const ex = getExtractor($("sel-extractor").value);
  $("extractor-note").textContent = ex?.needsKey
    ? "→ uses the proxy (provider/model set in Settings)"
    : "→ runs offline, no key needed";
}

// ── upload / ingest / extract ───────────────────────────────────────────────────
function wireUpload() {
  const drop = $("drop"), file = $("file");
  drop.addEventListener("click", () => file.click());
  file.addEventListener("change", () => file.files[0] && handleFile(file.files[0]));
  ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("drag")));
  drop.addEventListener("drop", e => { e.preventDefault(); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); });
  $("btn-samples").addEventListener("click", () => {
    const l = $("samples-list"); l.style.display = l.style.display === "none" ? "flex" : "none";
  });
}

function renderSamplesList() {
  $("samples-list").innerHTML = SAMPLES.map(s =>
    `<button class="btn small" data-sample="${s.id}">${esc(s.name)}</button>`).join("");
  $("samples-list").querySelectorAll("[data-sample]").forEach(b =>
    b.addEventListener("click", () => {
      const s = SAMPLES.find(x => x.id === b.dataset.sample);
      handleFile(sampleToFile(s));
      $("samples-list").style.display = "none";
    }));
}

async function handleFile(file) {
  if (file.size > 5 * 1024 * 1024) return toast("File too large (max 5MB)", "err");
  state.fileMeta = { name: file.name, type: file.type, size: file.size };
  $("ingest-info").textContent = `Reading ${file.name} …`;
  try {
    state.doc = await ingestFile(file);
  } catch (e) { return toast(`Ingest failed: ${e.message}`, "err"); }
  const t = state.doc.tables.reduce((n, x) => n + x.rows.length, 0);
  $("ingest-info").innerHTML =
    `Ingested <b>${esc(file.name)}</b> · ${state.doc.pages} page(s) · ${state.doc.tables.length} table(s), ${t} rows. Extracting…`;

  const ex = getExtractor($("sel-extractor").value);
  try {
    state.predicted = await ex.extract(state.doc);
  } catch (e) {
    $("ingest-info").innerHTML = `Ingested <b>${esc(file.name)}</b>.`;
    return toast(`Extraction failed: ${e.message}`, "err");
  }
  // Deep-clone predicted → working so we can diff corrections against the original.
  state.working = JSON.parse(JSON.stringify(state.predicted));
  state.working.source.fileName = file.name;
  $("ingest-info").innerHTML =
    `Ingested <b>${esc(file.name)}</b> · extracted by <b>${esc(state.predicted.meta.extractor)}</b>` +
    (state.predicted.meta.model ? ` (${esc(state.predicted.meta.model)})` : "") +
    ` in ${state.predicted.meta.durationMs}ms.`;
  renderReview();
}

// ── review table ────────────────────────────────────────────────────────────────
function renderReview() {
  const q = state.working;
  $("review-card").style.display = "block";
  $("review-meta").textContent =
    `${q.lineItems.length} line(s) · overall confidence ${pct(q.meta.overallConfidence)}`;

  $("f-vendor").value = q.source.vendor || "";
  $("f-quoteno").value = q.source.quoteNumber || "";
  $("f-valid").value = q.source.validUntil || "";
  $("f-currency").value = q.source.currency || "USD";
  $("f-customer").value = q.customer.name || "";
  $("f-markup").value = getSettings().defaultMarkupPct;
  [["f-vendor", "vendor"], ["f-quoteno", "quoteNumber"], ["f-valid", "validUntil"], ["f-currency", "currency"]]
    .forEach(([id, key]) => $(id).oninput = () => { q.source[key] = $(id).value; });
  $("f-customer").oninput = () => { q.customer.name = $("f-customer").value; };

  renderRows();
  renderWarnings();
}

function renderRows() {
  const q = state.working;
  const catSel = (sel) => CATEGORIES.map(c =>
    `<option value="${c}" ${c === sel ? "selected" : ""}>${CATEGORY_LABELS[c].split(" ")[0]}</option>`).join("");
  $("items-body").innerHTML = q.lineItems.map((li, i) => `
    <tr data-i="${i}">
      <td class="muted">${i + 1}</td>
      <td><input data-f="sku" value="${esc(li.sku || li.mfgPartNumber)}" placeholder="—"/></td>
      <td><input data-f="description" value="${esc(li.description)}"/></td>
      <td><select data-f="category" class="pill ${li.category}">${catSel(li.category)}</select></td>
      <td class="num"><input data-f="quantity" type="number" min="0" value="${li.quantity}"/></td>
      <td class="num"><input data-f="unitCost" type="number" min="0" step="0.01" value="${li.unitCost}"/></td>
      <td class="num"><input data-f="extendedCost" type="number" min="0" step="0.01" value="${li.extendedCost}"/></td>
      <td><div class="conf" title="${pct(li.confidence)}"><span style="width:${Math.round((li.confidence||0)*100)}%"></span></div></td>
      <td><button class="btn small" data-del="${i}" style="padding:2px 7px">×</button></td>
    </tr>`).join("");

  $("items-body").querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input", () => {
      const i = +el.closest("tr").dataset.i, f = el.dataset.f;
      const li = state.working.lineItems[i];
      if (f === "quantity" || f === "unitCost" || f === "extendedCost") {
        li[f] = num(el.value, 0);
        // Editing qty/unit recomputes ext; editing ext leaves it as typed.
        if (f === "quantity" || f === "unitCost") li.extendedCost = round2(li.unitCost * li.quantity);
        if (f === "extendedCost" && li.quantity > 0) li.unitCost = round2(li.extendedCost / li.quantity);
        recompute();
      } else { li[f] = el.value; if (f === "category") el.className = "pill " + el.value; }
    });
  });
  $("items-body").querySelectorAll("[data-del]").forEach(b =>
    b.addEventListener("click", () => { state.working.lineItems.splice(+b.dataset.del, 1); recompute(); renderRows(); }));
  renderTotals();
}

function recompute() { recomputeTotals(state.working); renderTotals(); renderWarnings(); }
function renderTotals() {
  const q = state.working;
  $("grand-total").textContent = money(q.totals.grandTotalCost, q.source.currency);
  $("cat-totals").innerHTML = CATEGORIES
    .filter(c => q.categoryTotals[c]?.cost)
    .map(c => `<span class="pill ${c}">${CATEGORY_LABELS[c].split(" ")[0]} ${money(q.categoryTotals[c].cost, q.source.currency)}</span>`)
    .join(" ") || '<span class="muted">—</span>';
}
function renderWarnings() {
  const w = state.working.meta.warnings || [];
  $("warnings").innerHTML = w.length
    ? `<div class="warn"><b>⚠ ${w.length} thing(s) to check:</b> ${w.map(esc).join(" · ")}</div>` : "";
}

function wireReviewButtons() {
  $("btn-add-line").addEventListener("click", () => {
    state.working.lineItems.push(makeLineItem({ description: "", quantity: 1, unitCost: 0, confidence: 1 }));
    recompute(); renderRows();
  });
  $("btn-save").addEventListener("click", () => {
    if (!state.working) return;
    recomputeTotals(state.working);
    recordCorrection(state.predicted, state.working, {
      fileName: state.working.source.fileName, extractor: state.predicted.meta.extractor,
      model: state.predicted.meta.model, docText: state.doc?.text || "",
    });
    toast("Correction saved to feedback dataset ✓", "ok");
    $("fb-count").textContent = `${getFeedback().length} example(s)`;
    // Best-effort push to the durable store so the learning isn't trapped locally.
    fullSync().then(r => { if (r?.error) console.warn("sync:", r.error); }).catch(() => {});
  });
  $("btn-template").addEventListener("click", () => {
    const markup = num($("f-markup").value, getSettings().defaultMarkupPct);
    const priced = applyMarkup(state.working, markup);
    const html = renderCustomerQuoteHtml(priced, { companyName: "Your Company" });
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    else toast("Pop-up blocked — allow pop-ups to preview", "err");
  });
  $("btn-crm").addEventListener("click", () => {
    const out = $("crm-out");
    const mapped = toCrmBuyQuote(state.working, state.fileMeta || {});
    out.style.display = out.style.display === "none" ? "block" : "none";
    out.textContent = JSON.stringify(mapped, null, 2);
  });
}

// ── feedback tab ────────────────────────────────────────────────────────────────
function wireFeedbackTab() {
  $("btn-export").addEventListener("click", () => {
    const data = exportJsonl();
    if (!data) return toast("No feedback yet", "err");
    download("feedback.jsonl", data, "application/jsonl");
  });
  $("btn-clear-fb").addEventListener("click", () => {
    if (confirm("Clear the LOCAL feedback copy? (The durable store is untouched — Sync to restore.)")) {
      clearFeedback(); renderFeedbackList();
    }
  });
  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    const { added, total } = importJsonl(await f.text());
    renderFeedbackList();
    toast(`Imported ${added} new (${total} total)`, "ok");
  });
  $("btn-sync").addEventListener("click", async () => {
    const r = await fullSync();
    if (r.skipped) return toast("Set a Feedback corpus URL in Settings to sync", "err");
    if (r.error) return toast(`Sync error: ${r.error}`, "err");
    renderFeedbackList();
    toast(`Synced · pushed ${r.pushed || 0}, pulled ${r.feedback?.added || 0} new`, "ok");
  });
}
function renderFeedbackList() {
  const all = getFeedback();
  $("fb-count").textContent = `${all.length} example(s)`;
  if (!all.length) { $("fb-list").innerHTML = '<p class="muted small">No corrections yet. Parse a quote, fix the table, and Save.</p>'; return; }
  $("fb-list").innerHTML = `<table><thead><tr><th>When</th><th>File</th><th>Extractor</th><th>Changes</th><th></th></tr></thead><tbody>${
    all.slice().reverse().map(e => `<tr>
      <td class="small">${new Date(e.ts).toLocaleString()}</td>
      <td>${esc(e.fileName)}</td>
      <td class="small">${esc(e.extractor)}${e.model ? " / " + esc(e.model) : ""}</td>
      <td><span class="tag">${e.diff.length} edit(s)</span></td>
      <td><button class="btn small" data-golden="${e.id}">Promote → golden</button></td>
    </tr>`).join("")}</tbody></table>`;
  $("fb-list").querySelectorAll("[data-golden]").forEach(b =>
    b.addEventListener("click", () => { promoteToGolden(b.dataset.golden); toast("Added to eval golden set ✓", "ok"); }));
}

// ── eval tab ────────────────────────────────────────────────────────────────────
function wireEvalTab() {
  $("btn-seed-golden").addEventListener("click", () => {
    const golden = getGolden();
    const existing = new Set(golden.map(g => g.name));
    let added = 0;
    for (const s of SAMPLES) {
      if (existing.has(s.fileName)) continue;
      golden.push({ id: uid(), name: s.fileName, ts: new Date().toISOString(),
        inputExcerpt: s.content, expected: makeStandardizedQuote(s.expected) });
      added++;
    }
    ss(KEYS.golden, golden);
    toast(`Seeded ${added} golden case(s) (${golden.length} total)`, "ok");
  });
  $("btn-run-eval").addEventListener("click", runEvaluation);
}

async function runEvaluation() {
  const golden = getGolden();
  if (!golden.length) return toast("No golden cases — click 'Seed golden from samples'", "err");
  const ex = getExtractor($("eval-extractor").value);
  $("eval-metrics").innerHTML = '<p class="muted">Running…</p>';
  const runExtractor = async (text, name) => {
    const doc = await ingestFile(new File([text], name));
    return ex.extract(doc);
  };
  let result;
  try { result = await runEval(golden, runExtractor); }
  catch (e) { return toast(`Eval failed: ${e.message}`, "err"); }
  renderEval(result, ex.label);
}

function renderEval(result, label) {
  const s = result.summary;
  const m = (v, l) => `<div class="metric"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $("eval-metrics").innerHTML =
    m((s.lineF1 * 100).toFixed(0) + "%", "Line F1") +
    m((s.linePrecision * 100).toFixed(0) + "%", "Precision") +
    m((s.lineRecall * 100).toFixed(0) + "%", "Recall") +
    m((s.categoryAccuracy * 100).toFixed(0) + "%", "Category acc.") +
    m((s.fieldAccuracy * 100).toFixed(0) + "%", "Header fields") +
    m((s.avgTotalPctError * 100).toFixed(1) + "%", "Total error");
  $("eval-detail").innerHTML =
    `<p class="small muted" style="margin:6px 0">${esc(label)} · ${s.cases} case(s)${s.errored ? `, ${s.errored} errored` : ""}</p>` +
    `<table><thead><tr><th>Case</th><th>F1</th><th>Cat</th><th>Total err</th><th>Lines (got/exp)</th></tr></thead><tbody>${
      result.perCase.map(c => c.error
        ? `<tr><td>${esc(c.name)}</td><td colspan="4" class="muted">error: ${esc(c.error)}</td></tr>`
        : `<tr><td>${esc(c.name)}</td><td>${(c.lineF1*100).toFixed(0)}%</td><td>${(c.categoryAccuracy*100).toFixed(0)}%</td>
           <td>${c.totalPctError==null?"—":(c.totalPctError*100).toFixed(1)+"%"}</td>
           <td>${c.predictedCount}/${c.expectedCount}</td></tr>`).join("")}</tbody></table>`;
}

// ── settings ────────────────────────────────────────────────────────────────────
function loadSettingsForm() {
  const s = getSettings();
  $("set-provider").value = s.provider;
  $("set-model").value = s.model;
  $("set-proxy").value = s.proxyUrl;
  $("set-feedback").value = s.feedbackUrl;
  $("set-token").value = s.apiToken;
  $("set-markup").value = s.defaultMarkupPct;
}
function wireSettings() {
  $("set-extractor").value = getSettings().extractorId;
  $("btn-save-settings").addEventListener("click", () => {
    saveSettings({
      extractorId: $("set-extractor").value,
      provider: $("set-provider").value,
      model: $("set-model").value.trim(),
      proxyUrl: $("set-proxy").value.trim() || "/api/extract",
      feedbackUrl: $("set-feedback").value.trim(),
      apiToken: $("set-token").value.trim(),
      defaultMarkupPct: num($("set-markup").value, 20),
    });
    $("sel-extractor").value = $("set-extractor").value;
    updateExtractorNote();
    toast("Settings saved ✓", "ok");
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────────
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function pct(n) { return n == null ? "—" : Math.round(n * 100) + "%"; }
function money(n, cur = "USD") {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur }).format(num(n, 0)); }
  catch { return `${cur} ${num(n, 0).toFixed(2)}`; }
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function download(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
let toastTimer;
function toast(msg, kind) {
  const el = $("toast"); el.textContent = msg;
  el.style.background = kind === "err" ? "#de350b" : kind === "ok" ? "#0b7a55" : "#172b4d";
  el.classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
