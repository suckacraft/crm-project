# Quote Parsing POC

Read a quote from any IT reseller or distributor, find the line items and
pricing wherever they sit, let a human review/correct the extraction, and turn
it into a **standardized customer-facing quote** — while collecting the
corrections needed to make the inference **better over time**.

Built to drop into the existing **[`crm-project`](https://github.com/suckacraft/crm-project)** CRM with
near-zero integration: same stack (vanilla JS, SheetJS, `localStorage`, CDN
libs) and the parsed output maps straight onto the CRM's existing **buy quote**
object and HW/SW/PS line-item model.

---

## Why this exists

The CRM already lets you attach a reseller quote to an opportunity as a *buy
quote* and split it into Hardware / Software / Professional-Services amounts —
but today a human has to **read the PDF/Excel and type those numbers in**. This
POC automates that step: ingest → interpret → review → standardize.

It is deliberately a **foundation**, not a finished product. The whole point is
the loop that lets accuracy climb:

```
 upload ─▶ ingest ─▶ extract ─▶ REVIEW & CORRECT ─▶ standardized template ─▶ customer
   (pdf/xls/        (LLM via      (human fixes        (+ map to CRM buyQuote)
    csv/email)       proxy, or     the table)
                     mock)              │
                                        ▼
                                  feedback dataset ──▶ eval harness ──▶ measure improvement
                                  (labeled examples)     (line F1, etc.)
```

---

## Quick start

### Option A — full pipeline with real LLM inference (recommended)

The serverless **proxy** holds the API keys so they never touch the browser.

```bash
# 1. set keys (either/both providers)
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# 2. install + run the proxy (Node 18+, zero runtime deps) and the app
npm install
npm run proxy      # key-holding /api/extract on :8787
npm run dev        # Vite dev server on :5173, proxies /api → :8787

# open http://localhost:5173
```

> Prefer no build step? `node proxy/server.js` also serves the raw app at
> `http://localhost:8787` (it serves `index.html` + `src/` directly — the
> modules load natively, no bundler needed).

In **Settings**, pick the provider (Anthropic Claude Haiku / OpenAI GPT-4o-mini)
and set the default extractor to **LLM via proxy**. Drop a quote on the Parse tab.

### Option B — offline, no keys

Just serve the folder and use the **Mock** extractor (the default):

```bash
python3 -m http.server 8787    # or: npx serve .
open http://localhost:8787
```

The Mock extractor is a real (if naive) heuristic parser — enough to demo the
whole pipeline and to act as the **baseline** the LLM is scored against.

> Click **“Load a sample quote”** to try the three bundled reseller formats
> (Ingram CSV, CDW PDF-style text, Insight HTML email) without uploading anything.

---

## How to use it

1. **Parse & Review** — drop a quote (or load a sample). The extractor fills a
   table of line items (SKU, description, type, qty, unit/extended cost) plus
   header fields (vendor, quote #, validity, currency). Warnings flag anything
   that doesn't reconcile (e.g. line sum ≠ stated total).
2. **Correct** anything wrong. Editing qty/unit recomputes extended cost (and
   vice-versa); category is a dropdown.
3. **Save correction → feedback** records a labeled example.
4. **Generate customer template** opens the standardized, branded quote (sell
   prices = cost × markup) ready to print/PDF/email.
5. **Show CRM buyQuote mapping** shows the exact object this becomes inside the
   CRM.
6. **Feedback** tab: browse/export the dataset (JSONL), or promote an example to
   the eval golden set.
7. **Eval** tab: seed golden from the samples, then score any extractor
   (line F1, category accuracy, total error) — run Mock vs an LLM to *prove* the
   improvement with numbers.

---

## Architecture in one breath

A pluggable **`Extractor`** turns an ingested document into a canonical
**`StandardizedQuote`** (`src/schema.js`) — the single source of truth that the
review UI edits, the eval harness scores, the customer template renders, and the
CRM adapter maps. Swapping inference engines (Mock → Claude/GPT → your company
LLM) touches only the extractor; nothing else changes.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full layout and the
schema, **[docs/MIGRATION.md](docs/MIGRATION.md)** for the exact method to fuse
this into `crm-project` (full modernization + `git subtree`) and swap in your
internal LLM, **[docs/LEARNING_CONTINUITY.md](docs/LEARNING_CONTINUITY.md)** for
how the feedback/eval corpus survives product change, and
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for hosting.

```
index.html              # app shell (matches crm-project styling)
src/
  schema.js             # StandardizedQuote — canonical shape + LLM JSON contract
  ingest.js             # File → {text, tables} for PDF / Excel / CSV / HTML-email
  normalize.js          # raw extractor output → clean, validated quote (+ category rules)
  extractors/
    base.js             # Extractor interface + registry
    mockExtractor.js    # offline heuristic baseline (no key)
    llmExtractor.js     # calls the proxy (Claude / GPT)
  template.js           # StandardizedQuote → customer quote HTML (+ markup)
  crmAdapter.js         # → crm-project buyQuote / line-item shapes
  integration/crmBridge.js  # the ONLY file the CRM imports (merge seam)
  feedback.js           # correction dataset (the improvement loop) + JSONL export
  evaluate.js           # accuracy metrics vs a golden set
  storage.js            # pluggable localStorage (prefix/scope → CRM's kb_* + user)
  samples.js            # 3 synthetic quotes + hand-labeled ground truth
  app.js                # UI controller
vite.config.js          # build + dev proxy (the toolchain the merged app adopts)
proxy/
  server.js             # local dev server + key-holding /api/extract
  api/extract.js        # serverless deployment (Vercel/Netlify/CF)
  handler.js providers.js prompt.js   # provider-agnostic extraction
tests/smoke.mjs         # node core tests (run: node tests/smoke.mjs)
```

## Tests

```bash
node tests/smoke.mjs
```

## Known POC limits (deliberately deferred)

- Browser `localStorage` for persistence (per the CRM's model); not multi-user.
- PDF ingest extracts text + reconstructs rows; scanned/image PDFs would need OCR.
- The Mock extractor is a heuristic baseline, not production accuracy — that's
  what the LLM and the feedback loop are for.
- File size capped at 5MB in the browser.
