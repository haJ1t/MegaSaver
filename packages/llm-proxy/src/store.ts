import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
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
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
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
