# What the `crm-project` chat should do now (to make fusion trivial)

Companion to [MIGRATION.md](./MIGRATION.md). These are CRM-side tasks that can be
done **before the parser arrives** and that the eventual `git subtree` merge
depends on. Each is low-risk and shippable on its own. Point the other chat at
this file.

## Priority 1 — add the build step (the biggest unlock)
Convert `crm-project` to a module + build project **without changing behaviour**:
1. Add `package.json` (`"type":"module"`), `vite` `^5`, and `vite.config.js`
   (copy the one in this repo — same dev-proxy to `/api`).
2. Move the giant inline `<script>` body into `src/legacy.js`; make `index.html`
   load `<script type="module" src="/src/main.js">`, and have `main.js` import
   `./legacy.js`. Ship this — identical behaviour, now buildable.

Why first: the merge target is "both features are ES modules." If the CRM is
already a module project, the parser drops straight in. If not, fusion means
modernizing two things at once.

## Priority 2 — extract `core/storage.js` first, expose the user id
The parser unifies storage by calling `configureStorage({ prefix:"kb", scope:userId })`.
For that to line up:
1. Pull the CRM's `K`, `KG`, `ls()/ss()`, `applyUserKeys`, and session logic into
   `src/core/storage.js` with **named exports**.
2. Export a `getCurrentUserId()` (the logged-in `KG.session.userId`).
   The parser's `initForCrm({ userId })` will pass it in.
3. Keep the existing scoping scheme — `applyUserKeys` makes keys `kb_<name>_u<uid>`.
   The parser now matches that exactly (`configureStorage({prefix:"kb",scope:uid})`
   → `kb_feedback_u<uid>`), so per-user data lands in the same namespace.

Result: at merge there is **one** storage module, shared by both features.

## Priority 3 — freeze the buy-quote object contract
The parser's `crmAdapter.js` already maps onto the CRM's buy-quote shape. Keep
these field names stable (the projection target):

```js
buyQuote = {
  id, name, type, size, addedAt, expiryDate,
  amount,                                  // grand total cost
  dataUrl,
  categories: [{ type: "hw"|"sw"|"ps", amount }]
}
```
If you rename any of these, that's fine — just tell the parser chat so the one
adapter file changes. Don't fork the shape silently.

## Priority 4 — make the buy-quote upload a clean seam
Today `openQuoteForm(oppId, "buy")` reads a file and the human types amount +
categories. Refactor so there's **one obvious place** to add auto-fill later:
- Isolate the buy-quote upload into `src/crm/quotes.js`.
- Inside the `FileReader.onload`, leave a clearly marked hook (even a comment is
  enough for now) where Phase 3 will call `buildBuyQuoteFromFile(file, fileMeta)`.
- Don't deeply couple parsing assumptions in — the form should keep working with
  zero parser present (manual entry is the fallback forever).

## Priority 5 — don't duplicate the parser
- **Do not** start building quote parsing / a line-item extraction schema in the
  CRM chat. `src/schema.js` (StandardizedQuote) here is the single source of
  truth; `buyQuote` is just a projection of it.
- **Do not** add a second settings store for provider/model/markup — the parser
  ships `getSettings()/saveSettings()`; plan to surface those in the CRM's
  existing settings panel.

## Persistence & databasing best practices (REQUIRED)

We decided the durable home for data is a **managed Postgres database** (so it
lives off GitHub and survives product change), with `localStorage` demoted to a
**working cache**. The CRM must align with this — do **not** entrench
localStorage-only persistence. See
[LEARNING_CONTINUITY.md](./LEARNING_CONTINUITY.md) for the full rationale.

Concretely, on the CRM side:

1. **The learning corpus is NOT the CRM's to store.** The parser owns it and
   syncs it to the managed DB via `/api/feedback` + `/api/golden`. Don't copy
   feedback/eval data into CRM tables or reinvent its storage. Just call
   `initForCrm({ userId })` — the parser handles sync + the standalone→user data
   shim automatically.

2. **Treat `localStorage` as a cache, not the source of truth.** Today the CRM
   persists opportunities/quotes/files in `localStorage` (`kb_*_u<uid>`). That's
   fine for the POC, but plan the same durability tier the parser uses:
   - a server-side **managed-Postgres** persistence layer behind a small API
     (mirror the proxy's pattern: `GET/POST /api/...`, env-selected backend);
   - `localStorage` becomes an offline/working copy that **syncs** to the DB on
     save + rehydrates on boot (mirror `src/dataset/sync.js`).

3. **Apply the corpus's permanence principles to ALL durable records** (opps,
   quotes, attachments):
   - **versioned records** + **migrations on read** (you already do this with
     `CONFIG_VERSION`/`migrateConfig` — keep it, extend it; never drop data);
   - **provenance/timestamps** on records so history is auditable;
   - **never hard-delete** — soft-delete/version so history survives;
   - **backups / PITR** enabled on the managed DB; **auth** on every write API;
     **CORS** locked to your origin; treat customer/pricing data as confidential.

4. **One DB contract, many clients.** The CRM and the parser should both be
   clients of managed-DB-backed APIs with the same shape (`GET`→items,
   `POST {items}`→{appended}). That's what lets you move off GitHub and swap
   hosts without touching the front-end.

> POC reality check: you don't have to migrate all CRM data to Postgres today.
> The requirement now is to (a) let the parser sync the corpus to the managed DB,
> and (b) not build new localStorage-only persistence that you'll have to unwind.
> Structure CRM persistence so a DB tier slots in behind the same sync pattern.

## Hygiene that keeps the two chats mergeable
- **No new globals** — everything module-scoped (the parser is). Globals are the
  main thing that clashes on merge.
- **Match tooling** — Node 18+, ESM, Vite `^5` (same as this repo).
- **Centralize key strings** — never hardcode `kb_...` outside `core/storage.js`.
- **Work on a branch** (`merge/modularize`) so the modernization is one reviewable
  track.

## Quick "ready to fuse?" checklist
- [ ] CRM builds with `vite build`
- [ ] `src/core/storage.js` exports `ls, ss, getCurrentUserId` (+ scoping intact)
- [ ] buy-quote object fields match the contract above
- [ ] buy-quote upload lives in its own module with a marked auto-fill hook
- [ ] no quote-parsing logic duplicated in the CRM
- [ ] corpus left to the parser (synced to the managed DB via /api/feedback) — not copied into CRM storage
- [ ] no NEW localStorage-only persistence added; CRM persistence structured to take a managed-DB tier
- [ ] no new globals; Node/Vite versions match
