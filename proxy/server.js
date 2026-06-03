// ─────────────────────────────────────────────────────────────────────────────
// server.js — local dev server. Does two jobs:
//   1. Serves the static POC app (index.html, /src, /samples) from the repo root
//   2. Exposes POST /api/extract → handleExtract (the key-holding proxy)
//
// Run:  ANTHROPIC_API_KEY=... OPENAI_API_KEY=... node proxy/server.js
// Then: open http://localhost:8787
//
// Zero dependencies (Node 18+ built-ins only). For production, deploy
// proxy/api/extract.js as a serverless function and host the static files
// anywhere; this file is just the convenient all-in-one for local dev.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleExtract } from "./handler.js";
import { handleFeedback } from "./feedbackStore.js";
import { corsHeaders, authError, maxBody } from "./http.js";

const ROOT = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const PORT = process.env.PORT || 8787;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml",
  ".txt": "text/plain", ".map": "application/json",
};

const server = createServer(async (req, res) => {
  const cors = corsHeaders();
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const isApi = req.url.startsWith("/api/");
  if (isApi) {
    const denied = authError(n => req.headers[n.toLowerCase()]);
    if (denied) { res.writeHead(denied.status, { "content-type": "application/json" }); return res.end(JSON.stringify(denied.json)); }
  }

  if (req.method === "POST" && req.url.startsWith("/api/extract")) {
    try {
      const body = await readBody(req);
      const result = await handleExtract(JSON.parse(body || "{}"));
      res.writeHead(result.status, { "content-type": "application/json" });
      return res.end(JSON.stringify(result.json));
    } catch (e) {
      res.writeHead(e.code === "TOO_LARGE" ? 413 : 500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // Durable corpus: /api/feedback and /api/golden (GET to read, POST to append).
  const fbMatch = req.url.match(/^\/api\/(feedback|golden)\b/);
  if (fbMatch && (req.method === "GET" || req.method === "POST")) {
    try {
      const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : null;
      const result = await handleFeedback(req.method, fbMatch[1], body);
      res.writeHead(result.status, { "content-type": "application/json" });
      return res.end(JSON.stringify(result.json));
    } catch (e) {
      res.writeHead(e.code === "TOO_LARGE" ? 413 : 500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // Static file serving (path-traversal-safe).
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error("dir");
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const limit = maxBody();
    let b = "", size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > limit) { const e = new Error("request body too large"); e.code = "TOO_LARGE"; req.destroy(); return reject(e); }
      b += c;
    });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"].filter(k => process.env[k]);
  console.log(`Quote-Parser POC running →  http://localhost:${PORT}`);
  console.log(keys.length ? `Providers ready: ${keys.join(", ")}`
    : "⚠  No provider keys set — LLM extraction will 500. Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY. The Mock extractor still works.");
});
