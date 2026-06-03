# Kickoff prompt for the `crm-project` chat

Copy everything in the box below into the other chat (the one working on
`crm-project`) to start the fusion.

---

We're fusing two parallel projects into one product. **This repo (`crm-project`)
is our CRM.** A companion **quote-parsing POC** has been built in a separate repo
and needs to merge into this one. Your job: prepare this CRM for that fusion and
execute it in phases, following the POC repo's docs as the source of truth.

## The companion POC
Repo: **`suckacraft/test2`**, branch **`claude/reseller-quote-parsing-poc-bqqeG`**.
It reads IT reseller/distributor quotes (PDF / Excel / CSV / email-HTML), extracts
line items + pricing via a pluggable engine (offline mock + Claude/GPT behind a
serverless proxy), lets a human review/correct, generates a standardized customer
quote, and **learns over time** via a feedback + eval corpus. It was deliberately
built to match THIS CRM's stack (vanilla JS, SheetJS, localStorage) and to map
onto this CRM's existing **buy-quote** object + HW/SW/PS split.

## Read these first (in the test2 repo, that branch) — they are the spec
- `docs/CRM_PREP.md` — what to do on the CRM side (START HERE)
- `crm-patch/APPLY.md` + the `crm-patch/` files — a ready-to-apply Phase-1 patch
- `docs/MIGRATION.md` — the full phased fusion method (git subtree)
- `docs/LEARNING_CONTINUITY.md` — how the corpus stays durable
- `docs/DEPLOYMENT.md` — hosting the app + proxy + managed DB

## Decisions already made (do not relitigate)
- **Full modernization**: ES modules + a **Vite** build; the CRM and the parser
  both become first-class modules.
- **Repos fused via `git subtree`** (POC lands under `src/features/quote/`).
- **LLM behind a serverless proxy**; **Anthropic + OpenAI** switchable.
- **Durable data lives in a managed Postgres DB** (off GitHub). `localStorage` is
  a working cache that syncs to the DB. The parser already does this for its
  corpus via `/api/feedback`.

## Phase 1 — do now (modernize this CRM, NO behaviour change)
1. Apply `crm-patch/`: add `package.json`, `vite.config.js`, `src/main.js`, and
   `src/core/storage.js` (the CRM's own storage/auth, extracted into a module
   with `getCurrentUserId()` added — verify it matches the current inline code and
   reconcile any drift).
2. Move the big inline `<script>` in `index.html` into `src/legacy.js`; replace
   the tag with `<script type="module" src="/src/main.js">`. Keep the CDN
   `<script>` tags (SheetJS, Chart.js).
3. Have `legacy.js` import storage/auth from `./core/storage.js` and delete the
   duplicated definitions; replace the global `currentUser` with
   `getCurrentUser()` / `setCurrentUser()`.
4. Verify: `npm install` → `npm run dev` (identical behaviour) → `npm run build`
   (produces `dist/`).

## Databasing & permanence (REQUIRED — follow `docs/CRM_PREP.md` §Persistence)
- **Don't** store the parser's feedback/eval corpus in CRM storage or reinvent
  it. It syncs to the managed DB via `/api/feedback` + `/api/golden`; you just
  call `initForCrm({ userId })`.
- **Don't** add new `localStorage`-only persistence. Treat `localStorage` as a
  cache and structure CRM persistence so a **managed-Postgres** tier slots in
  behind a sync pattern (mirror `src/dataset/sync.js`).
- Apply the corpus's permanence principles to all durable records: versioned
  records + migrations on read (extend your `CONFIG_VERSION`/`migrateConfig`),
  provenance/timestamps, never hard-delete, DB backups + write-API auth +
  origin-locked CORS, treat customer/pricing data as confidential.

## Guardrails (keep fusion clean)
- Do NOT build any quote-parsing / line-item schema here — the POC owns it
  (`StandardizedQuote` is the single source of truth).
- Do NOT rename the buy-quote object fields
  `{ id, name, type, size, addedAt, expiryDate, amount, dataUrl, categories:[{type,amount}] }` —
  the POC's `crmAdapter.js` targets them. If a field already differs here, report
  the exact current shape back instead of changing it.
- No new globals; everything module-scoped. Node 18+, ESM, Vite ^5.

## Report back when Phase 1 builds
(a) confirmation `npm run build` succeeds;
(b) the EXACT current buy-quote object shape + the function that creates it
    (`openQuoteForm`);
(c) the current logged-in user id accessor.
That lets the POC chat finalize the integration seam.

## Later phases (for reference — I'll guide you)
- **Phase 2:** `git subtree add --prefix=src/features/quote <test2-url> <branch>`;
  after login call `initForCrm({ userId: getCurrentUserId() })` (auto-migrates
  standalone dev data and shares the `kb_<name>_u<uid>` namespace).
- **Phase 3:** in `openQuoteForm` (buy quote), after the file is read, call
  `buildBuyQuoteFromFile()` from `features/quote/integration/crmBridge.js` to
  pre-fill amount + HW/SW/PS (additive; manual entry stays the fallback). Snippet
  in `docs/MIGRATION.md` §Phase 3.
- **Phase 4–6:** deploy the proxy + corpus API with `DATABASE_URL` set
  (managed Postgres), point Settings, retire the standalone shell.

Start with Phase 1 and the report-back.

---
