# Deployment

Two pieces to host:

1. **The app** — static files (`vite build` → `dist/`). Hostable anywhere.
2. **The proxy** — one serverless function (`/api/extract`) holding the provider
   keys. Only needed for **LLM** extraction; the **Mock** extractor needs nothing.

The cleanest setup puts both on **one origin** so the app's default
`proxyUrl` (`/api/extract`) just works with **no CORS**. Config for that is
already in this repo.

| Platform | App + proxy same origin? | What's wired up here |
|---|---|---|
| **Vercel** (recommended) | ✅ yes | `vercel.json` + `api/extract.js` |
| **Cloudflare Pages** | ✅ yes | `functions/api/extract.js` |
| **Netlify** | ✅ yes | small adapter (below) |
| **GitHub Pages** | ❌ app only | `.github/workflows/deploy.yml` (proxy goes elsewhere) |

---

## Option 1 — Vercel (one origin, turnkey)

1. Import the repo in Vercel. It auto-detects Vite (build `vite build`, output
   `dist`) and treats `api/extract.js` as a serverless function.
2. Project → Settings → **Environment Variables**:
   - `ANTHROPIC_API_KEY` = `sk-ant-…`
   - `OPENAI_API_KEY` = `sk-…`
3. Deploy. The app is at `https://<project>.vercel.app`, the proxy at
   `/api/extract` on the same origin. Leave Settings → `proxyUrl` = `/api/extract`.

`api/extract.js` just re-exports `proxy/api/extract.js` (default export = a
`(req,res)` handler), so there's nothing extra to maintain.

## Option 2 — Cloudflare Pages (one origin)

1. Create a Pages project from the repo. Build command `npm run build`, output
   directory `dist`.
2. Pages picks up `functions/api/extract.js` → route `/api/extract`.
3. Settings → **Functions** → enable the **`nodejs_compat`** compatibility flag
   (the function bridges `context.env` → `process.env`).
4. Add `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as environment variables.

## Option 3 — Netlify (one origin)

Netlify static publish is `dist`; add a function adapter (Netlify uses a
different handler signature). Create `netlify/functions/extract.js`:

```js
import { handleExtract } from "../../proxy/handler.js";
export default async (req) => {
  const result = await handleExtract(await req.json().catch(() => ({})));
  return new Response(JSON.stringify(result.json), {
    status: result.status, headers: { "content-type": "application/json" },
  });
};
```

and `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"
[functions]
  directory = "netlify/functions"
[[redirects]]
  from = "/api/extract"
  to = "/.netlify/functions/extract"
  status = 200
```

Set the two API keys in Site settings → Environment variables.

## Option 4 — GitHub Pages (app only) + proxy elsewhere

Pages can't run the proxy. Use the included workflow for the app and host the
proxy on Vercel/Cloudflare, then point the app at it cross-origin.

1. **App:** push to `main` → `.github/workflows/deploy.yml` builds with
   `VITE_BASE=/<repo>/` and publishes `dist` to Pages. (Repo → Settings → Pages →
   Source: GitHub Actions.)
2. **Proxy:** deploy just the proxy to Vercel/Cloudflare (Options 1–2). Note its
   URL, e.g. `https://quote-proxy.vercel.app/api/extract`.
3. In the app's **Settings → Proxy URL**, paste that absolute URL. The proxy
   already returns permissive CORS headers, so the cross-origin call works.

> Heads-up: the proxy's `Access-Control-Allow-Origin: *` is fine for a POC. For
> production, lock it to your app's origin (edit `cors()` / the headers in
> `proxy/api/extract.js` and `proxy/server.js`).

---

## Durable corpus: managed Postgres (production)

The feedback/eval corpus is stored in a **managed database** so it lives off
GitHub and survives any product change. The proxy serves it at `/api/feedback`
and `/api/golden`; the backend is chosen by env.

1. **Provision** a managed Postgres (Neon, Supabase, RDS, Cloud SQL — any works).
2. **Set env** on the proxy/host:
   - `CORPUS_BACKEND=postgres`
   - `DATABASE_URL=postgres://user:pass@host:5432/db`
   - `PGSSL=require` (most managed providers require TLS)
3. **Install the driver** where the proxy runs: `cd proxy && npm install`
   (`pg` is an optionalDependency, so the file backend stays zero-dep).
4. The `corpus` table is **auto-created on first write** — no manual migration.
5. In the app's **Settings → Feedback corpus URL**, set `/api/feedback` (same
   origin) so the browser syncs to the DB.

Without these env vars the proxy falls back to local JSONL files (`DATA_DIR`),
which is fine for dev but ephemeral on serverless — don't rely on it in prod.

> On serverless, also enable connection pooling appropriate to the platform
> (e.g. Neon's pooled connection string / Supabase pgBouncer) since functions
> are short-lived.

## Local development

```bash
npm install
npm run proxy      # :8787  (needs ANTHROPIC_API_KEY / OPENAI_API_KEY)
npm run dev        # :5173  (Vite proxies /api → :8787)
```

## Production hardening (built in — just set env)

The proxy ships transport guards (`proxy/http.js`) that are **open when unset**
(local dev) and **locked when set** (production):

- `API_TOKEN` — require `Authorization: Bearer <token>` on every `/api/*` request
  (extract **and** corpus), so the proxy isn't an open relay to your paid LLM
  accounts / corpus. Set the same value in the app's **Settings → API token**.
- `ALLOWED_ORIGIN` — lock CORS to your app's origin instead of `*`.
- `MAX_BODY_BYTES` — request body cap (default 4 MB; returns 413 over limit).

Also:
- **Secrets** live only in the platform's env vars — never in the repo. (The API
  token does reach the browser, so it gates abuse, not per-user access; for true
  per-user control, front the proxy with the CRM session once merged.)
- **Swap in your company LLM** by adding a provider in `proxy/providers.js`; no
  redeploy of the front-end needed.
