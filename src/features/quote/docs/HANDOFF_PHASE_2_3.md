# Handoff: Phases 2 & 3 (graft + wire the auto-fill)

For the `crm-project` chat, after Phase 1 (modernization) is merged. Prereqs
confirmed: the CRM builds as ESM+Vite, exposes `getCurrentUserId()`, and its
buy-quote object matches the contract below — so **no `crmAdapter.js` change is
needed**.

```js
// CRM buy-quote (confirmed) === toCrmBuyQuote() output
{ id, name, type, size, addedAt, expiryDate /* ISO YYYY-MM-DD */,
  amount /* grand total */, dataUrl, categories: [{ type: "hw"|"sw"|"ps", amount }] }
```

## Phase 2 — graft the parser (preserves history)

```bash
git checkout -b merge/quote-parser
git subtree add --prefix=src/features/quote \
  https://github.com/suckacraft/test2.git claude/reseller-quote-parsing-poc-bqqeG
```

This lands the whole POC under `src/features/quote/` (its own `src/`, `proxy/`,
`docs/`, `tests/`). The bridge is therefore at
`src/features/quote/src/integration/crmBridge.js` (the nested `src` is expected —
the POC keeps its modules under `src/`). Future updates: `git subtree pull` with
the same prefix/URL/branch.

Right after a successful login (where you call `setCurrentUser(user)`):

```js
import { initForCrm } from "./features/quote/src/integration/crmBridge.js";
initForCrm({ userId: getCurrentUserId() });
// → parser shares the kb_<name>_u<uid> namespace and auto-migrates any
//   standalone qp_* dev data on first run.
```

Verify `npm run build` still succeeds with the subtree present.

## Phase 3 — auto-fill the buy-quote form (additive, zero regression)

In `openQuoteForm`, only for `type === "buy"`. Manual entry stays the fallback if
parsing fails or no LLM is configured.

```js
import { buildBuyQuoteFromFile, recordReview } from "./features/quote/src/integration/crmBridge.js";

// after #qf-file exists in the buy-quote form:
document.getElementById("qf-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || type !== "buy") return;
  try {
    // extractorId:"mock" validates the wiring with NO proxy/keys.
    // Switch to "llm" once the proxy + DATABASE_URL are deployed.
    const { quote, buyQuote } = await buildBuyQuoteFromFile(
      file, { name: file.name, type: file.type, size: file.size }, { extractorId: "mock" });

    document.getElementById("qf-amount").value = buyQuote.amount ?? "";
    buyQuote.categories.forEach(c => {
      const cb = area.querySelector(`.qf-cat-cb[data-cat="${c.type}"]`);
      if (cb) {
        cb.checked = true;
        cb.dispatchEvent(new Event("change"));            // reveals amt field + updateUnalloc
        area.querySelector(`.qf-cat-amt[data-cat="${c.type}"]`).value = c.amount;
      }
    });
    area._predicted = quote;                              // stash for the feedback loop
    showToast("Auto-filled from quote — please review", "ok");
  } catch (err) {
    showToast("Auto-parse unavailable — enter manually");
  }
});

// in the existing #qf-save click handler, after the quote is saved:
if (area._predicted) {
  // For a real training signal, pass the human-CORRECTED quote as the 2nd arg.
  // See "Feedback fidelity" below — passing _predicted twice records a no-op.
  recordReview(area._predicted, area._predicted, { fileName: file.name });
}
```

### Feedback fidelity (important)
The CRM's buy-quote form only captures `amount` + category split, so it can't
express line-item-level corrections. Two options, in order of value:

1. **Best:** surface the parser's own review table (from `src/features/quote`) in
   the CRM's quote detail, edit there, and pass the edited `StandardizedQuote` to
   `recordReview(predicted, corrected, …)`. Full-fidelity corrections → best
   learning signal.
2. **Interim:** reconstruct a minimal corrected quote from the edited
   amount/categories and pass that. Captures coarse corrections only.

Until one of those is wired, keep `recordReview` but know predicted-vs-predicted
is a no-op — it won't teach the model anything.

## Report back
- `npm run build` passes with the subtree in place.
- Mock auto-fill populates amount + HW/SW/PS on a sample reseller quote.

Then we deploy the proxy + corpus with `DATABASE_URL` (managed Postgres), set the
app's Settings (`proxyUrl`, `feedbackUrl`), and flip `extractorId` to `"llm"`.
