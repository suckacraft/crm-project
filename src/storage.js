// ─────────────────────────────────────────────────────────────────────────────
// storage.js — pluggable localStorage persistence.
//
// Standalone (this POC):     keys are "qp_<name>"          (no user scope)
// Hosted inside crm-project: call configureStorage({ prefix:"kb", scope:userId })
//   → keys become "kb_<name>__<userId>", matching the CRM's per-user scoping
//     (see applyUserKeys in crm-project). This is the ONE switch that unifies
//     storage at merge time; nothing else in the app changes.
// ─────────────────────────────────────────────────────────────────────────────

const cfg = {
  prefix: "qp",     // namespace; CRM uses "kb"
  scope: "",        // per-user suffix; CRM passes the logged-in user id
  backend: null,    // optional custom store (defaults to window.localStorage)
};

/** Configure storage once at boot (before any read/write). */
export function configureStorage(opts = {}) {
  if (opts.prefix != null) cfg.prefix = opts.prefix;
  if (opts.scope != null) cfg.scope = opts.scope;
  if (opts.backend) cfg.backend = opts.backend;
  return { ...cfg };
}

/** Resolve a logical name to a concrete, namespaced + scoped storage key.
 *  Standalone:  "qp_feedback"
 *  Hosted:      "kb_feedback_u<uid>"  — matches crm-project's applyUserKeys scheme. */
export function storageKey(name) {
  return `${cfg.prefix}_${name}${cfg.scope ? `_u${cfg.scope}` : ""}`;
}

let _mem;
function store() {
  if (cfg.backend) return cfg.backend;
  if (typeof localStorage !== "undefined") return localStorage;
  return (_mem ||= memoryStore());   // singleton fallback (tests / non-browser)
}

// Logical key names — resolved live so configureStorage() takes effect even if
// called after this module is imported.
export const KEYS = {
  get settings() { return storageKey("settings"); },
  get feedback() { return storageKey("feedback"); },
  get golden() { return storageKey("golden"); },
};

export function ls(key, dflt = null) {
  try { const v = store().getItem(key); return v == null ? dflt : JSON.parse(v); }
  catch { return dflt; }
}
export function ss(key, value) {
  try { store().setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.warn("storage full or blocked", e); return false; }
}

const DEFAULT_SETTINGS = {
  extractorId: "mock",
  provider: "anthropic",
  model: "",
  proxyUrl: "/api/extract",
  feedbackUrl: "",          // durable corpus endpoint, e.g. "/api/feedback"; "" = local only
  apiToken: "",             // sent as Authorization: Bearer to a locked-down proxy
  defaultMarkupPct: 20,
  currency: "USD",
};

/** Auth header for proxy/corpus calls when an API token is configured. */
export function authHeaders() {
  const t = getSettings().apiToken;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function getSettings() { return { ...DEFAULT_SETTINGS, ...(ls(KEYS.settings, {}) || {}) }; }
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  ss(KEYS.settings, next);
  return next;
}

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// In-memory fallback so the module is usable outside the browser (e.g. tests).
function memoryStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v),
    removeItem: k => m.delete(k) };
}
