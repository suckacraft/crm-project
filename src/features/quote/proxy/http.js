// ─────────────────────────────────────────────────────────────────────────────
// http.js — shared transport guards for every endpoint (extract + corpus),
// across the local server and all serverless wrappers. Read live from env so:
//   • local dev (no env set)        → open, frictionless
//   • production (env set)          → locked down
//
// Env:
//   API_TOKEN        if set, requests must send Authorization: Bearer <token>
//                    (or x-api-token). Protects the proxy from being an open
//                    relay to your paid LLM accounts / corpus.
//   ALLOWED_ORIGIN   if set (e.g. https://app.example.com), CORS is locked to it
//                    instead of "*".
//   MAX_BODY_BYTES   request body cap (default 4 MB).
// ─────────────────────────────────────────────────────────────────────────────

export function maxBody() { return Number(process.env.MAX_BODY_BYTES || 4_000_000); }

export function corsHeaders() {
  const allow = process.env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

/**
 * @param getHeader (name) => string|undefined  (case-insensitive accessor)
 * @returns null if authorized, else { status, json } to return verbatim.
 */
export function authError(getHeader) {
  const token = process.env.API_TOKEN || "";
  if (!token) return null;                       // unset → open (local dev)
  const raw = getHeader("authorization") || getHeader("x-api-token") || "";
  const presented = String(raw).replace(/^Bearer\s+/i, "").trim();
  if (presented && safeEqual(presented, token)) return null;
  return { status: 401, json: { error: "unauthorized" } };
}

// Constant-time string compare (pure JS — works in Node and edge runtimes).
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
