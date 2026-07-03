import { appendFileSync, chmodSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ProxyUsageEvent, proxyUsageEventSchema } from "./usage-event.js";

// Append-only JSONL of usage events (counts only). One line per round-trip; a
// single-process line append is atomic enough and keeps the on-disk shape
// greppable. Mirrors the stats overlay store's JSONL convention.
function usagePath(storeRoot: string): string {
  return join(storeRoot, "proxy-usage", "usage.jsonl");
}

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

export async function appendProxyUsage(input: {
  storeRoot: string;
  event: ProxyUsageEvent;
}): Promise<void> {
  const event = proxyUsageEventSchema.parse(input.event);
  const path = usagePath(input.storeRoot);
  const dir = dirname(path);
  // The metering log lives under the operator's store: keep the dir 0700 and the
  // file 0600, and refuse to append through a symlink so a planted link cannot
  // redirect writes out of the store.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("refusing symlinked usage log");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("refusing")) throw e;
    // ENOENT is fine — the file is created below.
  }
  appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

export async function listProxyUsage(input: {
  storeRoot: string;
}): Promise<readonly ProxyUsageEvent[]> {
  let raw: string;
  try {
    raw = readFileSync(usagePath(input.storeRoot), "utf8");
  } catch (e) {
    if (isErrno(e) && e.code === "ENOENT") return [];
    throw e;
  }
  const out: ProxyUsageEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(proxyUsageEventSchema.parse(JSON.parse(trimmed)));
  }
  return out;
}
