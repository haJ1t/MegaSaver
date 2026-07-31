import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import { appendOverlayEvent } from "../src/store.js";

// B11 follow-up: the daemon write and the hook's timeout fallback are
// concurrent BY CONSTRUCTION (two processes racing on the same event id), so
// the dedupe must be check-AND-append under one lock — an unlocked
// check-then-append lets both writers miss each other's line and double-count.
//
// withFileLock is synchronous, so an in-process Promise.all cannot interleave
// the two calls; instead this white-box probe asserts the ORDERING PROPERTY the
// fix guarantees: every read of the events JSONL that serves the dedupe check
// happens while the summary lock file exists (i.e. inside the locked section).
// Under the pre-fix code the check ran before lock acquisition, so the lock
// file was absent at read time and this pins red.

const reads: { lockHeld: boolean }[] = [];
let probeLockPath = "";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const tapped: typeof actual.readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const [path] = args;
    if (typeof path === "string" && path.endsWith(".events.jsonl") && probeLockPath !== "") {
      reads.push({ lockHeld: actual.existsSync(probeLockPath) });
    }
    return actual.readFileSync(...args);
  }) as typeof actual.readFileSync;
  return { ...actual, default: actual, readFileSync: tapped };
});

const WK = "0123456789abcdef";
const LSID = "11111111-1111-4111-8111-111111111111";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-lockdedupe-"));
  reads.length = 0;
  probeLockPath = "";
});
afterEach(() => {
  probeLockPath = "";
  rmSync(root, { recursive: true, force: true });
});

const makeEvent = (): OverlayTokenSaverEvent =>
  ({
    id: "ove-deadbeefdeadbeefdeadbeefdeadbeef",
    workspaceKey: WK,
    liveSessionId: LSID,
    createdAt: "2026-07-31T12:00:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 1000,
    returnedBytes: 200,
    bytesSaved: 800,
    deltaBytes: 800,
    savingRatio: 0.8,
    summary: "s",
    mode: "balanced",
  }) as OverlayTokenSaverEvent;

describe("appendOverlayEvent — dedupe check runs inside the summary lock", () => {
  it("reads the events ledger for the dedupe check only while holding the lock", () => {
    const store = { root };
    appendOverlayEvent({ store, event: makeEvent(), secretsRedacted: 0, chunksStored: 1 });

    // Arm the probe only for the replay append: its events-file reads are the
    // dedupe check (the summary self-heal path reads the .json, not the JSONL).
    probeLockPath = join(root, "stats", WK, `${LSID}.json.lock`);
    reads.length = 0;
    const result = appendOverlayEvent({
      store,
      event: makeEvent(),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    probeLockPath = "";

    expect(result.appended).toBe(false);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.lockHeld)).toBe(true);

    const lines = readFileSync(join(root, "stats", WK, `${LSID}.events.jsonl`), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);
  });
});
