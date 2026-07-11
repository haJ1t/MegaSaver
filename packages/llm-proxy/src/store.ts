import { appendFileSync, chmodSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ProxyUsageEvent, proxyUsageEventSchema } from "./usage-event.js";

// The usage log's canonical location, shared by the tolerant reader below
// and any read-only consumer that wants the raw file.
export function proxyUsageLogPath(storeRoot: string): string {
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
  const path = proxyUsageLogPath(input.storeRoot);
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

export type ReadProxyUsageResult = {
  events: readonly ProxyUsageEvent[];
  skippedLines: number;
};

// F32 parity with the overlay events reader: one torn/garbage line must not
// zero every future report. Invalid lines are skipped and COUNTED so loss
// becomes visible upstream instead of silent.
export async function readProxyUsage(input: {
  storeRoot: string;
}): Promise<ReadProxyUsageResult> {
  let raw: string;
  try {
    raw = readFileSync(proxyUsageLogPath(input.storeRoot), "utf8");
  } catch (e) {
    if (isErrno(e) && e.code === "ENOENT") return { events: [], skippedLines: 0 };
    throw e;
  }
  const events: ProxyUsageEvent[] = [];
  let skippedLines = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      events.push(proxyUsageEventSchema.parse(JSON.parse(trimmed)));
    } catch {
      skippedLines += 1;
    }
  }
  return { events, skippedLines };
}

export async function listProxyUsage(input: {
  storeRoot: string;
}): Promise<readonly ProxyUsageEvent[]> {
  return (await readProxyUsage(input)).events;
}
