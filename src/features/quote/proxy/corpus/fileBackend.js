// File backend — append-only JSONL on disk. Zero dependencies. The default for
// local dev and the smoke test. DATA_DIR is read per call so tests can set it.

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

function dir() { return process.env.DATA_DIR || join(process.cwd(), "data"); }

export function makeFileBackend() {
  return {
    name: "file",
    async read(kind) { return readAll(join(dir(), `${kind}.jsonl`)); },
    async append(kind, items) {
      const file = join(dir(), `${kind}.jsonl`);
      const existing = new Set((await readAll(file)).map(x => x.id));
      const fresh = items.filter(x => x && x.id && !existing.has(x.id));
      if (fresh.length) {
        await mkdir(dir(), { recursive: true });
        await appendFile(file, fresh.map(x => JSON.stringify(x)).join("\n") + "\n");
      }
      return { appended: fresh.length, total: existing.size + fresh.length };
    },
  };
}

async function readAll(file) {
  try {
    const text = await readFile(file, "utf8");
    return text.split(/\r?\n/).filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
