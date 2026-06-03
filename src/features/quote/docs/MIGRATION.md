# Migration: fusing the quote-parser POC into `crm-project`

The method for merging the two parallel chats/repos into **one modernized,
modular project** — and the things already done here to make that merge
mechanical instead of a rewrite.

- **Target architecture:** full modernization — one app, ES modules, a build
  step (Vite), both the CRM and the quote-parser as first-class feature modules,
  the proxy deployed as serverless `/api`.
- **Repo fusion:** `git subtree` (best practice for folding one repo into a
  subfolder of another while preserving history and allowing ongoing sync).

> This session can only write to `test2`, so the CRM-side edits in Phases 1–5
> must be run in a session scoped to `crm-project`. Everything here is the exact
> recipe; the POC side (Phase 0) is already done.

---

## 1. Where we are

| | `crm-project` | `test2` (this POC) |
|---|---|---|
| Form | one inline `<script>` in `index.html` | ES modules under `src/` + Vite |
| Storage | `localStorage` `kb_*`, per-user scoped (`applyUserKeys`) | `localStorage`, pluggable prefix/scope (`configureStorage`) |
| Data model | `buyQuote` + HW/SW/PS | `StandardizedQuote` (bridged by `crmAdapter.js`) |
| Backend | none | dependency-free serverless proxy (`proxy/`) |
| History | `main` | `claude/reseller-quote-parsing-poc-*` |

## 2. Target end-state

```
crm-project/                     # single repo after fusion
├─ index.html                    # thin shell: loads CDN libs + <script module src=src/main.js>
├─ vite.config.js                # build + dev proxy to /api
├─ package.json
├─ src/
│  ├─ main.js                    # boots the app, wires routes/tabs
│  ├─ core/
│  │  ├─ storage.js              # ONE storage module (kb_* + user scope)  ← shared
│  │  ├─ auth.js                 # from CRM (hashPassword, sessions, applyUserKeys)
│  │  └─ ui.js                   # shared toast/format/dom helpers
│  ├─ crm/                       # CRM feature, split out of the old inline script
│  │  ├─ opportunities.js  board.js  list.js  forecast.js  oppDetail.js  settings.js
│  │  └─ quotes.js               # buy/sell quote attach UI — calls the bridge ↓
│  └─ features/quote/            # ← the POC, dropped in here (git subtree)
│     ├─ schema.js  ingest.js  normalize.js  template.js  crmAdapter.js
│     ├─ evaluate.js  feedback.js  samples.js
│     ├─ extractors/ …
│     └─ integration/crmBridge.js   # the only file crm/ imports from features/quote
└─ api/
   └─ extract.js                 # the proxy as a serverless function
```

Two rules keep it clean:
- **`src/core/` is shared** — storage, auth, ui. The POC already routes all
  persistence through `storage.js`; at merge it simply *becomes* `core/storage.js`.
- **`features/quote` only ever exposes `integration/crmBridge.js` to the CRM.**
  All CRM-facing logic is in that one file already.

## 3. Repo fusion with `git subtree` (best practice)

Why subtree over the alternatives: it keeps **one** repo to clone/build/deploy
(unlike submodules, which add an update dance and can ship detached), and it
**preserves history** (unlike a squash-copy). It's also reversible.

```bash
# in a clone of crm-project, on a feature branch
git checkout -b merge/quote-parser

# add the POC as a remote and graft it under src/features/quote, history intact
git remote add quote-poc https://github.com/suckacraft/test2.git
git fetch quote-poc
git subtree add --prefix=src/features/quote quote-poc claude/reseller-quote-parsing-poc-bqqeG

# later, pull future POC improvements:
git subtree pull --prefix=src/features/quote quote-poc <branch>
```

> The POC currently keeps `src/` at the repo root. The subtree lands it at
> `src/features/quote/` — imports inside the POC are all relative, so they keep
> working unchanged. The standalone `index.html`, `proxy/server.js`, `tests/`
> and `samples/` come along too; you delete the standalone shell in Phase 6 and
> move `proxy/api/extract.js` → `api/extract.js`.

## 4. Phased plan

### Phase 0 — make the POC merge-ready ✅ (done in this repo)
- Storage is a pluggable adapter (`configureStorage({prefix, scope})`).
- All CRM-facing code is funnelled through `src/integration/crmBridge.js`.
- Build toolchain established (Vite) — same one the CRM will adopt.
- Data model already maps to the CRM via `crmAdapter.js`.

### Phase 1 — modernize `crm-project` (strangler-fig, no behaviour change)
1. Add `vite`, `package.json`, `vite.config.js` (copy this repo's).
2. Move the inline `<script>` body into `src/legacy.js`; `index.html` becomes
   `<script type="module" src="/src/main.js">`, and `main.js` imports `legacy.js`.
   *Ship this first — identical behaviour, now buildable.*
3. Carve the legacy file into modules **incrementally**, lowest-risk first:
   `core/storage.js` (the `kb_*` + `applyUserKeys` logic) → `core/auth.js` →
   `crm/quotes.js` → the rest. Each extraction is one small, testable PR.

### Phase 2 — graft the POC
- Run the `git subtree add` from §3.
- Point the POC at the CRM's storage: in the CRM bootstrap call
  `initForCrm({ userId })` from `crmBridge.js` (sets prefix `kb` + user scope).
- De-duplicate: the merged app keeps **one** `storage.js` (CRM's, which the POC
  now imports) and **one** UI helper set. The POC's `schema.js` stays the single
  source of truth for the quote shape.

### Phase 3 — wire the seam (the payoff)
In the CRM's buy-quote upload (`openQuoteForm`, `type === "buy"`), after the file
is read, pre-fill the amount + categories instead of leaving them blank:

```js
import { buildBuyQuoteFromFile, recordReview } from "../features/quote/integration/crmBridge.js";

// inside the existing FileReader.onload, once you have `file` + `ev.target.result`:
const fileMeta = { id: uid(), name: file.name, type: file.type, size: file.size, dataUrl: ev.target.result };
try {
  const { quote, buyQuote } = await buildBuyQuoteFromFile(file, fileMeta, { extractorId: "llm" });
  // pre-fill the existing form fields the user normally types:
  document.getElementById("qf-amount").value = buyQuote.amount ?? "";
  buyQuote.categories.forEach(c => {
    const cb = area.querySelector(`.qf-cat-cb[data-cat="${c.type}"]`);
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change"));
      area.querySelector(`.qf-cat-amt[data-cat="${c.type}"]`).value = c.amount; }
  });
  showToast("Auto-filled from quote — please review", "ok");
  area._predictedQuote = quote;            // stash for the feedback loop
} catch (e) { showToast("Auto-parse unavailable: " + e.message); /* manual entry still works */ }
```

The human still confirms — and that confirmation is the training signal:

```js
// when the user clicks the existing "Upload Quote" save button:
if (area._predictedQuote) recordReview(area._predictedQuote, /* final edited quote */, { fileName: file.name });
```

This is **additive**: if parsing fails or no key is set, the form behaves exactly
as it does today (manual entry). Zero regression risk.

### Phase 4 — unify storage
- The POC writes through `configureStorage({ prefix:"kb", scope:userId })` →
  same namespace as the CRM, per user. No collisions (`kb_settings__<user>`,
  `kb_feedback__<user>`, `kb_golden__<user>`).
- One-time migration of any standalone `qp_*` data: on first hosted boot, copy
  `qp_*` → `kb_*__<user>` then remove `qp_*` (a ~10-line shim, optional — POC
  data is dev-only).

### Phase 5 — deploy the proxy
- Move `proxy/api/extract.js` → `api/extract.js`; deploy crm-project to
  Vercel/Netlify/Cloudflare with `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` set.
- Set the app's Settings `proxyUrl` to `/api/extract` (same origin → no CORS).
- Swap in your **company LLM** later by adding a provider in `proxy/providers.js`
  — no front-end change.

### Phase 6 — retire scaffolding
- Delete the POC's standalone `index.html` / `proxy/server.js` (dev-only).
- Keep `tests/smoke.mjs`, `samples/`, and the **eval** tab — they're now your
  regression net for extraction quality.

## 5. Keeping the two chats aligned until then

So parallel work doesn't diverge before the merge:
- **One source of truth for the quote shape:** `src/schema.js`. The CRM's
  `buyQuote` is a *projection* of it (via `crmAdapter.js`) — never redefine the
  quote shape on the CRM side.
- **One integration surface:** only `crmBridge.js` may be imported by CRM code.
  If you need a new CRM call, add it there, not scattered.
- **Storage namespacing:** POC keys are already `prefix`-driven; never hardcode a
  literal `kb_`/`qp_` string anywhere except `storage.js`.
- **No new globals:** the POC is fully module-scoped; keep it that way so it
  can't clash with the CRM's globals.

## 6. Rollback

Each phase is an independent PR. Phase 1 changes nothing functionally (just
buildable). Phase 3 is additive and feature-flaggable (gate the auto-fill behind
a settings toggle). If anything misbehaves, revert the single PR — the manual
buy-quote flow underneath is untouched.
