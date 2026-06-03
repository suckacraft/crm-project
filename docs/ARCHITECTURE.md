# Architecture

## Design goals (from the brief)

1. **Read quotes from many resellers/distributors** in their wildly different
   formats (PDF, Excel/CSV, email/HTML).
2. **Understand where pricing & line items are** and extract them.
3. Be a **foundation that improves inference over time** — measurable, with a
   feedback loop.
4. **Produce a standardized customer template**.
5. **Extend the existing CRM** (`crm-project`) with minimal integration.

## The central idea: one canonical shape

Everything pivots around **`StandardizedQuote`** (`src/schema.js`). It is the
contract between every stage:

```
Extractor ─produces→ StandardizedQuote ←edits─ Review UI
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
  Customer template   CRM adapter        Eval harness
  (template.js)       (crmAdapter.js)    (evaluate.js)
```

Because the shape is fixed, you can replace any one stage without disturbing the
others. Most importantly, you can replace the **inference engine** freely.

### StandardizedQuote (abridged)

```jsonc
{
  "schemaVersion": "1.0",
  "source":   { "vendor", "vendorType", "quoteNumber", "quoteDate",
                "validUntil", "currency", "contact", "fileName" },
  "customer": { "name", "ref" },                       // filled by us
  "lineItems": [{
    "lineNo", "sku", "mfgPartNumber", "description",
    "category": "hw | sw | ps | other",
    "quantity", "unit",
    "unitCost", "extendedCost",                        // buy (from reseller)
    "unitPrice", "extendedPrice",                      // sell (derived via markup)
    "confidence", "sourceRef"                          // provenance for the loop
  }],
  "totals":         { "subtotalCost", "tax", "shipping", "grandTotalCost", "currency" },
  "categoryTotals": { "hw": {cost,price,count}, "sw": …, "ps": …, "other": … },
  "meta":           { "extractor", "model", "extractedAt", "durationMs",
                      "overallConfidence", "warnings": [] }
}
```

`hw/sw/ps` deliberately mirror the CRM's existing category split. `other` (e.g.
freight) is carried separately and folded into `hw` only at the CRM boundary,
where the CRM has no "other" lane yet.

The same file also exports **`SCHEMA_PROMPT`** — the exact JSON the LLM is told
to return — so the prompt and the data model can never drift apart.

## The pluggable Extractor

```js
interface Extractor {
  id; label; needsKey;
  async extract(ingestedDoc) -> StandardizedQuote
}
```

Registered in `src/extractors/base.js`. Three things to know:

- **MockExtractor** (`mockExtractor.js`) — offline heuristic: picks the most
  table-like block, maps columns by header keywords, classifies rows with the
  shared category rules in `normalize.js`. Zero config; it is the eval baseline.
- **LLMExtractor** (`llmExtractor.js`) — sends the ingested text + tables to the
  proxy and normalizes the response. Provider/model come from Settings.
- **Your company LLM (later)** — add a provider in `proxy/providers.js` and it
  appears as an option. No browser code changes.

All extractor output passes through **`normalizeExtraction`** so messy/partial
JSON becomes a clean, validated quote with repaired numbers and inferred
categories. This is why Mock and LLM behave identically downstream.

## Ingestion (`src/ingest.js`)

| Format        | How                                                            |
|---------------|---------------------------------------------------------------|
| Excel / CSV   | SheetJS → `tables[{name, rows}]` (already used by the CRM)     |
| PDF           | pdf.js text + Y/X row reconstruction → text **and** tables    |
| Email / HTML  | DOMParser → `<table>` grids + visible text                    |
| Plain text    | delimiter sniff for an opportunistic table                    |

Output `IngestedDocument = { fileName, mimeType, text, tables, pages }`. We pass
**both** a flat `text` view and structured `tables` to the LLM — tables are high
signal, text is the fallback/context.

## The improvement loop (`src/feedback.js`, `src/evaluate.js`)

This is what makes the POC a *foundation* rather than a one-shot tool.

- Every **Save correction** stores `{ inputExcerpt, predicted, corrected, diff }`
  — a labeled training/eval example — and can be exported as **JSONL**.
- Promote any example to the **golden set** (its corrected form = ground truth).
- The **eval harness** runs an extractor over the golden set and reports
  line-item **precision / recall / F1** (matched by SKU then fuzzy description),
  **category accuracy**, **grand-total % error**, and header-field accuracy.

Concretely, "better inferencing over time" means: run eval on Mock, run eval on
Claude/GPT, run eval again after improving the prompt or adding few-shot
examples drawn from the feedback set — and watch the numbers move.

### How the dataset feeds future inference

- **Prompt tuning / few-shot**: select high-diff examples as in-context
  exemplars in `proxy/prompt.js`.
- **Fine-tuning / eval**: the JSONL export (`input` → `output`) is a ready
  supervised dataset for your company LLM.
- **Per-vendor rules**: diffs cluster by `vendor`, revealing where a deterministic
  pre-parser for a known template (e.g. TD Synnex) would beat the generic path —
  enabling a future deterministic+LLM hybrid behind the same interface.

## The serverless proxy (`proxy/`)

Chosen so **API keys stay server-side**. It is dependency-free (Node 18+).

```
browser ──POST /api/extract──▶ handler.js ──▶ providers.js ──▶ Anthropic | OpenAI
                                   │
                                   └─ prompt.js (SYSTEM_PROMPT + SCHEMA_PROMPT from src/schema.js)
```

- `handler.js` builds the prompt, calls the chosen provider, and recovers JSON
  even if the model wraps it in prose/fences.
- `server.js` is a local all-in-one (serves the app **and** the endpoint).
- `api/extract.js` is the same handler wrapped for Vercel/Netlify/Cloudflare.

The proxy reuses `src/schema.js` directly, so there is one source of truth for
the schema across browser and server.

## Integrating into `crm-project`

The CRM stores a buy quote as:

```js
{ id, name, type, size, addedAt, expiryDate, amount, dataUrl,
  categories:[{ type:'hw'|'sw'|'ps', amount }] }
```

`src/crmAdapter.js` maps a `StandardizedQuote` straight onto that (`toCrmBuyQuote`),
plus a richer additive `parsed`/`lineItems` the CRM can adopt incrementally, and
`toCrmLineItems` to pre-fill the deal's line-item calculator.

**Lift path** (when ready):

1. Copy `src/*` into the CRM (or import as a module) — same stack, no build step.
2. In the CRM's `openQuoteForm` (buy quote), after the file is read, call
   `ingestFile` → extractor → `toCrmBuyQuote` to **pre-fill** amount + categories
   instead of leaving them blank. The human still confirms (and that confirmation
   is a feedback example).
3. Deploy `proxy/api/extract.js`; point Settings `proxyUrl` at it.
4. Later, swap the provider for your internal LLM in `proxy/providers.js`.

Nothing about the CRM's data model has to change to get value on day one.
