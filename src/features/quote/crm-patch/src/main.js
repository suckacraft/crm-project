// Module entry for crm-project after Phase 1.
//
// Step 1 (ship this first): main.js just imports the moved-as-is inline script.
// Behaviour is identical; the app is now a buildable module graph.
import "./legacy.js";

// Step 2+ (incremental): as you carve modules out of legacy.js, import them here
// instead, and have legacy.js import the shared pieces (auth/session/storage)
// from ./core/storage.js rather than its own globals. For example:
//
//   import { loadSession, setCurrentUser, ensureAdminUser } from "./core/storage.js";
//
// Step N (after the parser is grafted via git subtree into ./features/quote):
//   import { initForCrm } from "./features/quote/integration/crmBridge.js";
//   // after login: initForCrm({ userId: getCurrentUserId() });
