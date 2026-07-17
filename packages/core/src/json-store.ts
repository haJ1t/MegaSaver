import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Shared atomic-JSON-store mechanic for the small ADVISORY state stores
// (guard-state, warm-start-state, autopilot-store). It owns the filesystem
// plumbing only: the read returns raw parse-or-undefined and the caller applies
// its own Zod schema + fallback, so each store keeps its error posture (null vs
// fail-closed default). Deliberately no fsync — a lost advisory write is
// acceptable (re-onboards / stays disabled next read). The durable, throwing
// atomic writers (embed-memory, overlay-store, json-directory-store) do NOT use
// this: they fsync, guard symlinks, and raise on data-loss, a different contract.

// Parse-or-undefined. The caller applies its own schema + fallback.
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

// mkdir(recursive) + write to a .{uuid}.tmp + rename. Swallows all errors: a lost
// write falls back to each caller's safe default, and tmp+rename prevents a
// partial-file read.
export function writeJsonAtomic(dir: string, fileName: string, data: unknown): void {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${randomUUID()}.tmp`);
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, join(dir, fileName));
  } catch {
    // best-effort — see module contract above
  }
}
