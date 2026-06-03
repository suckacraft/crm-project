# Local Hosting Guide

This CRM is configured for fully local / on-premise operation.
No data leaves your network.

---

## Option A — Simplest: serve the built `dist/` folder

```bash
npm install
npm run build
npx serve dist
# → open http://localhost:3000
```

`serve` is a zero-config static file server. The built `dist/` folder is
self-contained; copy it anywhere.

---

## Option B — Run the Vite dev server (recommended while developing)

```bash
npm install
npm run dev
# → open http://localhost:5173
```

The dev server watches for file changes and hot-reloads.

---

## Option C — Serve `dist/` with nginx (production / always-on)

Install nginx, then drop a config like this:

```nginx
server {
    listen 80;
    server_name crm.internal;   # or your internal hostname

    root /path/to/crm-project/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Optional: restrict to internal IP range only
    # allow 192.168.0.0/16;
    # deny all;
}
```

Run `npm run build` whenever you update the app, then reload nginx.

---

## Moving away from GitHub

The app only needs GitHub for version control and CI/CD. You can replace both:

### Version control → Gitea (self-hosted GitHub alternative)

1. Install Gitea on any server: https://gitea.io  
   (Docker: `docker run -p 3000:3000 gitea/gitea`)
2. Create a repo, then change the remote:
   ```bash
   git remote set-url origin http://your-gitea-server:3000/yourorg/crm-project.git
   git push -u origin main
   ```
3. Delete this `.github/` folder if you won't use GitHub at all.

### Alternative: GitLab CE (self-hosted)

Same process — GitLab has built-in CI/CD pipelines if you want automated builds.

---

## Connecting to an internal AI model (quote parser)

The quote parser proxy supports any **OpenAI-compatible API** — including
Ollama, LM Studio, vLLM, and most self-hosted LLMs.

### Quick start with Ollama

```bash
# 1. Install Ollama: https://ollama.com
# 2. Pull a model
ollama pull llama3

# 3. Start the proxy
cd src/features/quote
INTERNAL_LLM_URL=http://localhost:11434/v1 \
INTERNAL_LLM_MODEL=llama3 \
node proxy/server.js

# 4. In CRM Settings → Quote Parser:
#    Extractor:  LLM (via proxy)
#    Provider:   Internal LLM (Ollama / LM Studio / vLLM)
#    Proxy URL:  http://localhost:8787/api/extract   (or wherever the proxy runs)
```

### LM Studio

Same as Ollama — LM Studio exposes an OpenAI-compatible server on
`http://localhost:1234/v1` by default. Set `INTERNAL_LLM_URL=http://localhost:1234/v1`.

### Environment variables for the proxy

| Variable | Default | Description |
|---|---|---|
| `INTERNAL_LLM_URL` | `http://localhost:11434/v1` | Base URL of your local LLM API |
| `INTERNAL_LLM_MODEL` | `llama3` | Model name to request |
| `ANTHROPIC_API_KEY` | — | Only if using Anthropic provider |
| `OPENAI_API_KEY` | — | Only if using OpenAI provider |
| `PORT` | `8787` | Port the proxy listens on |

---

## Security checklist

- [x] No CDN dependencies — SheetJS and Chart.js bundled locally (`public/vendor/`)
- [x] No external API calls from the browser (proxy URL enforces local-only)
- [x] No hardcoded credentials — first user to register becomes admin
- [x] GitHub Pages deployment disabled
- [x] All data stored in browser localStorage (per-user, scoped by user ID)
- [x] Passwords hashed with SHA-256 + per-user salt (requires HTTPS or localhost)
- [ ] **Recommended:** serve over HTTPS even on internal network (use a self-signed cert or internal CA)
- [ ] **Recommended:** restrict nginx to your internal IP range
- [ ] **Recommended:** set up regular localStorage export/backup (Settings → Export)
