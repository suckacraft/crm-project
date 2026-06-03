# Phase-1 patch for `crm-project` (modernize → buildable, no behaviour change)

Hand this folder to the crm-project chat. It implements **Priority 1 & 2** from
[CRM_PREP.md](../docs/CRM_PREP.md): make the CRM a Vite module project and extract
a shared `core/storage.js`. Behaviour stays identical; this just unblocks the
fusion. ~30 minutes of mechanical work.

## Files in this patch
- `package.json` → repo root
- `vite.config.js` → repo root
- `src/main.js` → the module entry
- `src/core/storage.js` → the extracted storage/auth module (taken from the
  current inline script, modularized, with `getCurrentUserId()` added)

## Steps

1. **Copy the files** above into `crm-project` at the indicated paths.

2. **Split the inline script** in `index.html`:
   - Cut everything between `<script>` … `</script>` (the big app script) into a
     new file `src/legacy.js`.
   - Replace that script tag with:
     ```html
     <script type="module" src="/src/main.js"></script>
     ```
   - Keep the CDN `<script>` tags (SheetJS, Chart.js) as they are — they stay
     global. `main.js` imports `legacy.js`, so the app runs exactly as before,
     now through Vite.

3. **De-duplicate storage/auth** (do this incrementally, test after each):
   - At the top of `legacy.js`, import the shared pieces and delete their old
     definitions from `legacy.js`:
     ```js
     import {
       K, KG, CONFIG_VERSION, applyUserKeys, ls, ss, clone, uid,
       hashPassword, genSalt, getUsers, saveUsers, registerUser, loginUser,
       saveSession, loadSession, clearSession, migrateExistingDataToUser,
       ensureAdminUser, getCurrentUser, setCurrentUser, getCurrentUserId,
     } from "./core/storage.js";
     ```
   - Replace the old global `currentUser` with `getCurrentUser()` /
     `setCurrentUser(user)` (e.g. set it right after a successful `loginUser`).
     `setCurrentUser` already calls `applyUserKeys(user.id)` for you.

4. **Verify:**
   ```bash
   npm install
   npm run dev      # app behaves exactly as before
   npm run build    # produces dist/
   ```

## What this sets up for the merge
- The CRM is now a module + build project → the parser (also Vite/ESM) drops in
  via `git subtree` with no toolchain reconciliation.
- There is **one** storage module. When the parser is grafted under
  `src/features/quote/`, call once after login:
  ```js
  import { initForCrm } from "./features/quote/integration/crmBridge.js";
  initForCrm({ userId: getCurrentUserId() });   // parser shares kb_<name>_u<uid>
  ```

## Do NOT (keeps fusion clean)
- Don't change the `buyQuote` object field names (the parser's adapter targets
  them). If you must, tell the parser chat.
- Don't build any quote-parsing / line-item schema here — that's the parser's job.
- Don't introduce new globals; keep everything module-scoped.
