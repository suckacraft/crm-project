// Node smoke test for the environment-neutral core (no browser needed).
// Run: node tests/smoke.mjs   → exits non-zero on failure.
import { mockExtractor } from "../src/extractors/mockExtractor.js";
import { normalizeExtraction } from "../src/normalize.js";
import { validateQuote, makeStandardizedQuote } from "../src/schema.js";
import { scoreCase } from "../src/evaluate.js";
import { applyMarkup } from "../src/template.js";
import { toCrmBuyQuote } from "../src/crmAdapter.js";
import { handleExtract } from "../proxy/handler.js";
import { SAMPLES } from "../src/samples.js";
import { migrateExample } from "../src/dataset/contract.js";
import { recordCorrection, getFeedback, clearFeedback, exportJsonl, importJsonl } from "../src/feedback.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("✗", msg); } };

// 1) Mock extractor on a reconstructed table doc (Ingram sample).
const ingramDoc = {
  fileName: "ingram-Q88231.csv", mimeType: "text/csv",
  text: SAMPLES[0].content, pages: 1,
  tables: [{ name: "CSV", rows: [
    ["Part Number", "Description", "Qty", "Unit Price", "Extended"],
    ["UCSX-210C-M7", "Cisco UCS X210c M7 Compute Node", "2", "4200.00", "8400.00"],
    ["MSWS-2022-STD", "Windows Server 2022 Standard License (16-core)", "4", "780.00", "3120.00"],
    ["FREIGHT", "Shipping & Handling", "1", "145.00", "145.00"],
  ]}],
};
const q = await mockExtractor.extract(ingramDoc);
ok(q.lineItems.length === 3, `mock should find 3 lines, got ${q.lineItems.length}`);
ok(q.lineItems[0].category === "hw", `line1 category should be hw, got ${q.lineItems[0].category}`);
ok(q.lineItems[1].category === "sw", `line2 category should be sw, got ${q.lineItems[1].category}`);
ok(q.lineItems[2].category === "other", `line3 category should be other, got ${q.lineItems[2].category}`);
ok(Math.abs(q.totals.subtotalCost - 11665) < 0.01, `subtotal should be 11665, got ${q.totals.subtotalCost}`);

// 2) Validation passes on the extracted quote.
ok(validateQuote(q).ok, "validation should pass on extracted quote");

// 3) Scoring against golden gives a perfect-ish line F1 for this clean case.
const golden = makeStandardizedQuote(SAMPLES[0].expected);
const sc = scoreCase(q, golden);
ok(sc.lineF1 >= 0.99, `line F1 should be ~1 for clean table, got ${sc.lineF1}`);
ok(sc.categoryAccuracy >= 0.99, `category accuracy should be ~1, got ${sc.categoryAccuracy}`);

// 4) Markup produces sell prices and a grand total price.
const priced = applyMarkup(golden, 20);
ok(Math.abs(priced.totals.grandTotalPrice - 11665 * 1.2) < 0.5,
  `grand total price ≈ ${11665 * 1.2}, got ${priced.totals.grandTotalPrice}`);

// 5) CRM mapping folds 'other' into hw and produces categories[].
const crm = toCrmBuyQuote(golden, { name: "ingram.csv", type: "text/csv" });
ok(crm.amount === 11665, `crm amount should be 11665, got ${crm.amount}`);
const hw = crm.categories.find(c => c.type === "hw");
ok(hw && Math.abs(hw.amount - (8400 + 145)) < 0.01, `hw should fold freight → 8545, got ${hw?.amount}`);

// 6) normalize repairs a missing extendedCost from unitCost*qty.
const norm = normalizeExtraction({ lineItems: [{ description: "Switch", quantity: 3, unitCost: 100 }] }, { extractor: "test" });
ok(norm.lineItems[0].extendedCost === 300, `extendedCost should be repaired to 300, got ${norm.lineItems[0].extendedCost}`);

// 7) Proxy handler loads + fails gracefully without a key (imports/prompt build OK).
const noKey = await handleExtract({ provider: "anthropic", documentText: "x", tables: [] });
ok(noKey.status === 500 && /ANTHROPIC_API_KEY/.test(noKey.json.error),
  `proxy should report missing key, got ${JSON.stringify(noKey.json)}`);

// 8) Legacy v0 example migrates to the current contract without data loss.
const legacy = { id: "x1", ts: "2026-01-01T00:00:00Z", fileName: "old.csv",
  extractor: "mock", model: "heuristic-v1", inputExcerpt: "raw", predicted: q, corrected: golden, diff: [] };
const mig = migrateExample(legacy);
ok(mig.exampleSchemaVersion === 1, `legacy should migrate to v1, got ${mig.exampleSchemaVersion}`);
ok(mig.id === "x1" && mig.provenance.extractor === "mock" && mig.corrected === golden,
  "migration should preserve id/provenance/label");

// 9) Feedback record → export JSONL → import round-trips (corpus is portable).
clearFeedback();
recordCorrection(q, golden, { fileName: "ingram.csv", extractor: "mock", model: "heuristic-v1", docText: "raw text" });
ok(getFeedback().length === 1, `should have 1 example, got ${getFeedback().length}`);
const ex0 = getFeedback()[0];
ok(ex0.provenance && ex0.provenance.appVersion && ex0.exampleSchemaVersion === 1,
  "recorded example should carry provenance + version");
const jsonl = exportJsonl();
clearFeedback();
const imp = importJsonl(jsonl);
ok(getFeedback().length === 1 && imp.added === 1, `import should restore 1 example, got ${getFeedback().length}`);

// 10) Durable server-side store: POST appends + dedupes, GET reads back.
process.env.DATA_DIR = join(tmpdir(), "qp-smoke-" + Date.now());
const { handleFeedback } = await import("../proxy/feedbackStore.js");
const post1 = await handleFeedback("POST", "feedback", { items: [{ id: "a" }, { id: "b" }] });
ok(post1.json.appended === 2, `first post should append 2, got ${post1.json.appended}`);
const post2 = await handleFeedback("POST", "feedback", { items: [{ id: "b" }, { id: "c" }] });
ok(post2.json.appended === 1, `dedup: second post should append 1, got ${post2.json.appended}`);
const get1 = await handleFeedback("GET", "feedback", null);
ok(get1.json.items.length === 3, `store should hold 3 deduped items, got ${get1.json.items.length}`);

// 11) Standalone → CRM data shim copies qp_* into the kb_<name>_u<uid> namespace.
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
})();
localStorage.setItem("qp_feedback", JSON.stringify([{ id: "z" }]));
const { migrateStandaloneData } = await import("../src/integration/crmBridge.js");
const shim = migrateStandaloneData("42");
ok(shim.migrated === 1, `shim should migrate 1 key, got ${shim.migrated}`);
ok(localStorage.getItem("kb_feedback_u42") === JSON.stringify([{ id: "z" }]),
  "shim should copy qp_feedback → kb_feedback_u42");

// 12) Auth guard: open when API_TOKEN unset; enforced + constant-time when set.
const { authError, corsHeaders } = await import("../proxy/http.js");
delete process.env.API_TOKEN;
ok(authError(() => "") === null, "auth should be open when API_TOKEN unset");
process.env.API_TOKEN = "s3cret-token";
ok(authError(() => "")?.status === 401, "auth should reject missing token");
ok(authError(() => "Bearer wrong")?.status === 401, "auth should reject wrong token");
ok(authError(() => "Bearer s3cret-token") === null, "auth should accept Bearer token");
ok(authError(() => "s3cret-token") === null, "auth should accept raw x-api-token");
process.env.ALLOWED_ORIGIN = "https://app.example.com";
ok(corsHeaders()["Access-Control-Allow-Origin"] === "https://app.example.com", "CORS should lock to ALLOWED_ORIGIN");
delete process.env.API_TOKEN; delete process.env.ALLOWED_ORIGIN;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
