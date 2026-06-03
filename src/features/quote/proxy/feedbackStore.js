// ─────────────────────────────────────────────────────────────────────────────
// feedbackStore.js — the durable corpus endpoint, with a pluggable backend.
//
//   GET  /api/<kind>            → { items, backend }
//   POST /api/<kind> {items}    → { appended, total, backend }   (deduped by id)
//   kind ∈ { feedback, golden }
//
// Backend is chosen by env, so the corpus can live wherever is most sustainable
// without changing the client or the HTTP contract:
//   • CORPUS_BACKEND=postgres (or just DATABASE_URL set) → managed DB  (production)
//   • otherwise                                          → JSONL files (local/dev)
// ─────────────────────────────────────────────────────────────────────────────

import { makeFileBackend } from "./corpus/fileBackend.js";
import { makePostgresBackend } from "./corpus/postgresBackend.js";

const KINDS = new Set(["feedback", "golden"]);

let _backend;
function getBackend() {
  if (_backend) return _backend;
  const choice = (process.env.CORPUS_BACKEND || "").toLowerCase();
  const useDb = choice === "postgres" || (!choice && !!process.env.DATABASE_URL);
  _backend = useDb ? makePostgresBackend() : makeFileBackend();
  return _backend;
}

export async function handleFeedback(method, kind, body) {
  if (!KINDS.has(kind)) return { status: 400, json: { error: `unknown kind "${kind}"` } };
  const b = getBackend();
  try {
    if (method === "GET") {
      return { status: 200, json: { items: await b.read(kind), backend: b.name } };
    }
    if (method === "POST") {
      const items = Array.isArray(body?.items) ? body.items : [];
      const r = await b.append(kind, items);
      return { status: 200, json: { ...r, backend: b.name } };
    }
    return { status: 405, json: { error: "GET or POST only" } };
  } catch (e) {
    return { status: 500, json: { error: e.message } };
  }
}
