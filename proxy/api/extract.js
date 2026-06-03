// ─────────────────────────────────────────────────────────────────────────────
// api/extract.js — serverless function wrapper (Vercel / Netlify-functions
// style). Same handler the local server uses; deploy this and point the app's
// Settings → proxyUrl at it. Keys come from the platform's env vars. Auth + CORS
// are enforced by the shared guards in ../http.js (open locally, locked in prod).
// ─────────────────────────────────────────────────────────────────────────────

import { handleExtract } from "../handler.js";
import { corsHeaders, authError } from "../http.js";

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const denied = authError(n => req.headers[n.toLowerCase()]);
  if (denied) { res.status(denied.status).json(denied.json); return; }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const result = await handleExtract(body);
  res.status(result.status).json(result.json);
}

// For platforms that pass a Web Request (Cloudflare Workers / Netlify Edge):
export async function onRequest(context) {
  const req = context.request;
  // Cloudflare passes secrets on context.env, but our modules read process.env.
  // Bridge them (requires the `nodejs_compat` flag so `process` exists).
  if (context.env && typeof process !== "undefined") {
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "API_TOKEN", "ALLOWED_ORIGIN"])
      if (context.env[k] && !process.env[k]) process.env[k] = context.env[k];
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  const denied = authError(n => req.headers.get(n));
  if (denied) return new Response(JSON.stringify(denied.json), { status: denied.status, headers: { "content-type": "application/json", ...corsHeaders() } });

  const body = await req.json().catch(() => ({}));
  const result = await handleExtract(body);
  return new Response(JSON.stringify(result.json), {
    status: result.status, headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
