// Serverless wrappers for the corpus endpoints, shared by Vercel (default
// export) and Cloudflare (onRequest). One factory per platform, bound to a kind.
// Auth + CORS enforced via the shared guards in ../http.js.

import { handleFeedback } from "../feedbackStore.js";
import { corsHeaders, authError } from "../http.js";

/** Vercel / Netlify-node style (req, res). */
export function vercel(kind) {
  return async (req, res) => {
    for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    const denied = authError(n => req.headers[n.toLowerCase()]);
    if (denied) { res.status(denied.status).json(denied.json); return; }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const r = await handleFeedback(req.method, kind, body);
    res.status(r.status).json(r.json);
  };
}

/** Cloudflare Pages Functions style onRequest(context). */
export function cf(kind) {
  return async (context) => {
    const req = context.request;
    // Bridge DB config + auth from context.env (needs the nodejs_compat flag).
    if (context.env && typeof process !== "undefined") {
      for (const k of ["DATABASE_URL", "CORPUS_BACKEND", "PGSSL", "API_TOKEN", "ALLOWED_ORIGIN"])
        if (context.env[k] && !process.env[k]) process.env[k] = context.env[k];
    }
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const denied = authError(n => req.headers.get(n));
    if (denied) return new Response(JSON.stringify(denied.json), { status: denied.status, headers: { "content-type": "application/json", ...corsHeaders() } });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : null;
    const r = await handleFeedback(req.method, kind, body);
    return new Response(JSON.stringify(r.json), {
      status: r.status, headers: { "content-type": "application/json", ...corsHeaders() },
    });
  };
}
