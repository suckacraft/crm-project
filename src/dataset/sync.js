// ─────────────────────────────────────────────────────────────────────────────
// sync.js — continuous transfer between the local working copy and the durable
// remote store. Best-effort and idempotent: push new local examples up, pull the
// canonical set down, merge by id. Safe to call on boot and after every save.
//
// This is the mechanism that makes learnings survive product change: the corpus
// is always converging to the durable store, so a wiped browser, a new origin,
// or a rewritten app simply re-pulls everything.
// ─────────────────────────────────────────────────────────────────────────────

import { LocalStore, RemoteStore } from "./store.js";

let pushedIds = new Set();

/** Push any local examples/golden not yet sent, then pull + merge the canonical set. */
export async function fullSync() {
  if (!RemoteStore.enabled()) return { skipped: "no feedbackUrl configured" };
  const result = {};
  try {
    // Push new local → remote.
    const newLocal = LocalStore.allExamples().filter(e => !pushedIds.has(e.id));
    if (newLocal.length) {
      await RemoteStore.push("feedback", newLocal);
      newLocal.forEach(e => pushedIds.add(e.id));
    }
    await RemoteStore.push("golden", LocalStore.allGolden()).catch(() => {});

    // Pull canonical → local (merge, never clobber).
    const remoteExamples = await RemoteStore.pull("feedback");
    result.feedback = LocalStore.upsertExamples(remoteExamples);
    const remoteGolden = await RemoteStore.pull("golden").catch(() => []);
    result.golden = LocalStore.upsertGolden(remoteGolden);
    result.pushed = newLocal.length;
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

/** Pull-only: rehydrate a fresh/wiped client from the durable store. */
export async function rehydrate() {
  if (!RemoteStore.enabled()) return { skipped: true };
  const examples = await RemoteStore.pull("feedback");
  const golden = await RemoteStore.pull("golden").catch(() => []);
  return {
    feedback: LocalStore.upsertExamples(examples),
    golden: LocalStore.upsertGolden(golden),
  };
}
