// ─────────────────────────────────────────────────────────────────────────────
// core/storage.js — extracted verbatim (then modularized) from crm-project's
// inline <script>: localStorage keys, per-user scoping, auth + session.
//
// This becomes the SHARED storage module for the merged app. The quote-parser
// feature points at it by calling its own configureStorage({prefix:"kb",
// scope:getCurrentUserId()}) at mount — landing parser data in the same
// kb_<name>_u<uid> namespace as the CRM.
//
// What stayed behind in legacy.js: the DOM/auth-overlay UI (showApp,
// showAuthOverlay, wireAuthEvents). Those should import getCurrentUser /
// setCurrentUser / loginUser / etc. from here instead of using globals.
// ─────────────────────────────────────────────────────────────────────────────

export const K = {
  config: "kb_config", data: "kb_data", upload: "kb_upload", nudge: "kb_nudge",
  notes: "kb_notes", activity: "kb_activity", fcField: "kb_fc_field",
  files: "kb_files", logo: "kb_logo",
};
export const KG = { users: "kb_users", session: "kb_session" };
export const CONFIG_VERSION = 3;

// ── Per-user key scoping ───────────────────────────────────────────────────────
export function applyUserKeys(uid2) {
  K.config   = "kb_config_u"  + uid2;
  K.data     = "kb_data_u"    + uid2;
  K.upload   = "kb_upload_u"  + uid2;
  K.nudge    = "kb_nudge_u"   + uid2;
  K.notes    = "kb_notes_u"   + uid2;
  K.activity = "kb_activity_u" + uid2;
  K.fcField  = "kb_fc_field_u" + uid2;
  K.files    = "kb_files_u"   + uid2;
  // K.logo stays global (shared)
}

// ── Generic JSON storage helpers (unchanged from the CRM) ──────────────────────
export function ls(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
export function ss(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
export function clone(x) { return JSON.parse(JSON.stringify(x)); }
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ── Current user (replaces the old global `currentUser`) ───────────────────────
let currentUser = null;
let currentScopeId = "";
export function setCurrentUser(u) {
  currentUser = u;
  // A user object has `id`; a restored session object has `userId`. Support both.
  currentScopeId = u?.id || u?.userId || "";
  if (currentScopeId) applyUserKeys(currentScopeId);
}
export function getCurrentUser() { return currentUser; }
/** The id the quote-parser passes to configureStorage({ scope }) / initForCrm. */
export function getCurrentUserId() { return currentScopeId; }

// ── Auth helpers ───────────────────────────────────────────────────────────────
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(password + salt);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
export function genSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
}
export function getUsers() { try { return JSON.parse(localStorage.getItem(KG.users) || "[]"); } catch { return []; } }
export function saveUsers(u) { localStorage.setItem(KG.users, JSON.stringify(u)); }

export async function registerUser(username, password, displayName, isAdmin = false) {
  const users = getUsers();
  if (users.find(u => u.username === username.toLowerCase())) return { err: "Username already exists" };
  if (password.length < 6) return { err: "Password must be at least 6 characters" };
  const salt = genSalt();
  const passhash = await hashPassword(password, salt);
  const user = { id: uid(), username: username.toLowerCase(), displayName: displayName || username,
    passhash, salt, isAdmin, createdAt: new Date().toISOString() };
  users.push(user); saveUsers(users);
  return { user };
}

export async function loginUser(username, password) {
  const users = getUsers();
  const user = users.find(u => u.username === username.toLowerCase().trim());
  if (!user) return { err: "No account found for that username" };
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passhash) return { err: "Incorrect password" };
  return { user };
}

export function saveSession(user, remember) {
  const sess = { userId: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin };
  (remember ? localStorage : sessionStorage).setItem(KG.session, JSON.stringify(sess));
}
export function loadSession() {
  const s = localStorage.getItem(KG.session) || sessionStorage.getItem(KG.session);
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}
export function clearSession() {
  localStorage.removeItem(KG.session); sessionStorage.removeItem(KG.session);
}

export function migrateExistingDataToUser(uid2) {
  const legacyKeys = ["kb_config", "kb_data", "kb_upload", "kb_nudge", "kb_notes", "kb_activity", "kb_fc_field", "kb_files"];
  legacyKeys.forEach(k => {
    const val = localStorage.getItem(k);
    if (val != null) {
      const newKey = k + "_u" + uid2;
      if (!localStorage.getItem(newKey)) localStorage.setItem(newKey, val);
    }
  });
}

export async function ensureAdminUser() {
  const users = getUsers();
  if (!users.find(u => u.username === "joshua.sakajiou@perfekt.com.au")) {
    await registerUser("joshua.sakajiou@perfekt.com.au", "Perfekt2024!", "Josh", true);
  }
}
