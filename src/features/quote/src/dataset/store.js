// ─────────────────────────────────────────────────────────────────────────────
// store.js — where the corpus lives, behind a stable interface so the backend
// can change without touching the rest of the app (same idea as the extractor
// registry). Two layers, on purpose:
//
//   LocalStore  — synchronous localStorage working copy the UI reads/writes.
//   RemoteStore — the DURABLE source of truth (the proxy / a DB / object store),
//                 reached over HTTP. The corpus's real home.
//
// sync.js reconciles the two. If the browser is wiped or the product changes,
// the corpus is rehydrated from RemoteStore — that's the continuity guarantee.
// ─────────────────────────────────────────────────────────────────────────────

import { KEYS, ls, ss, getSettings, authHeaders } from "../storage.js";
import { migrateExample } from "./contract.js";

// ── Local working copy (synchronous) ──────────────────────────────────────────
export const LocalStore = {
  allExamples() {
    return (ls(KEYS.feedback, []) || []).map(migrateExample).filter(Boolean);
  },
  saveExamples(list) { ss(KEYS.feedback, list); },
  appendExample(ex) {
    const all = this.allExamples();
    all.push(ex);
    this.saveExamples(all);
    return ex;
  },
  upsertExamples(incoming) {
    // Merge by id; keep the newest capturedAt. Idempotent → safe to call on sync.
    const byId = new Map(this.allExamples().map(e => [e.id, e]));
    let added = 0;
    for (const raw of incoming) {
      const e = migrateExample(raw);
      if (!e) continue;
      const prev = byId.get(e.id);
      if (!prev || (e.capturedAt || "") > (prev.capturedAt || "")) {
        if (!prev) added++;
        byId.set(e.id, e);
      }
    }
    this.saveExamples([...byId.values()]);
    return { added, total: byId.size };
  },
  clear() { ss(KEYS.feedback, []); },

  allGolden() { return ls(KEYS.golden, []) || []; },
  saveGolden(list) { ss(KEYS.golden, list); },
  upsertGolden(incoming) {
    const byId = new Map(this.allGolden().map(g => [g.id, g]));
    let added = 0;
    for (const g of incoming) { if (!byId.has(g.id)) added++; byId.set(g.id, g); }
    this.saveGolden([...byId.values()]);
    return { added, total: byId.size };
  },
};

// ── Durable remote (async) ────────────────────────────────────────────────────
// Talks to the proxy's /api/feedback + /api/golden endpoints. Disabled when no
// feedbackUrl is configured (the app still works fully on LocalStore alone).
export const RemoteStore = {
  baseUrl() { return (getSettings().feedbackUrl || "").replace(/\/$/, ""); },
  enabled() { return !!this.baseUrl(); },

  async pull(kind = "feedback") {
    const r = await fetch(`${this.baseUrl()}/${kind}`, { method: "GET", headers: { ...authHeaders() } });
    if (!r.ok) throw new Error(`pull ${kind} ${r.status}`);
    const body = await r.json();
    return body.examples || body.golden || body.items || [];
  },
  async push(kind, items) {
    if (!items.length) return { appended: 0 };
    const r = await fetch(`${this.baseUrl()}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ items }),
    });
    if (!r.ok) throw new Error(`push ${kind} ${r.status}`);
    return r.json();
  },
};
