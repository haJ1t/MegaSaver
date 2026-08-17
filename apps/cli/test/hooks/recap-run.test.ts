import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAPSULE_VERSION, type WorkStateCapsule, capsulePath } from "../../src/hooks/capsule.js";
import {
  RECAP_FALLBACK_WINDOW_MS,
  buildRecapHookOutput,
  renderRecapStdout,
} from "../../src/hooks/recap-run.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);
const NOW = Date.parse("2026-08-06T12:00:00.000Z");

function capsule(capturedAt: string): WorkStateCapsule {
  return {
    version: CAPSULE_VERSION,
    capturedAt,
    trigger: "auto",
    intent: { prompt: "fix auth", ts: NOW - 60_000 },
    filesTouched: [{ path: "src/a.ts", chunkSetId: "cs-abc", createdAt: capturedAt }],
    commandsRun: [{ command: "pnpm test", chunkSetId: "cs-cmd", createdAt: capturedAt }],
    searchCount: 0,
    fetchCount: 0,
    openDecisions: [],
  };
}

function writeCapsule(sessionId: string, value: WorkStateCapsule): void {
  const path = capsulePath(storeRoot, wk, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "recap-run-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("buildRecapHookOutput", () => {
  it("injects the capsule for source=compact with lossless chunk pointers", () => {
    writeCapsule("sess-1", capsule(new Date(NOW - 30_000).toISOString()));
    const text = buildRecapHookOutput({
      payload: { session_id: "sess-1", cwd, source: "compact" },
      storeRoot,
      now: () => NOW,
    });
    expect(text).toContain("src/a.ts");
    expect(text).toContain("cs-abc");
    expect(text).toContain("fix auth");
  });

  it.each(["startup", "resume", "clear"])("emits nothing for source=%s", (source) => {
    writeCapsule("sess-1", capsule(new Date(NOW - 30_000).toISOString()));
    expect(
      buildRecapHookOutput({
        payload: { session_id: "sess-1", cwd, source },
        storeRoot,
        now: () => NOW,
      }),
    ).toBe("");
  });

  it("emits nothing when no capsule exists", () => {
    expect(
      buildRecapHookOutput({
        payload: { session_id: "sess-1", cwd, source: "compact" },
        storeRoot,
        now: () => NOW,
      }),
    ).toBe("");
  });

  it("falls back to a fresh sibling-session capsule but ignores stale ones", () => {
    writeCapsule("other-session", capsule(new Date(NOW - 60_000).toISOString()));
    const hit = buildRecapHookOutput({
      payload: { session_id: "sess-new", cwd, source: "compact" },
      storeRoot,
      now: () => NOW,
    });
    expect(hit).toContain("cs-abc");
    const stale = buildRecapHookOutput({
      payload: { session_id: "sess-new", cwd, source: "compact" },
      storeRoot,
      now: () => NOW + RECAP_FALLBACK_WINDOW_MS + 60_000,
    });
    expect(stale).toBe("");
  });
});

describe("renderRecapStdout", () => {
  it("wraps text in the SessionStart additionalContext envelope", () => {
    expect(JSON.parse(renderRecapStdout("recap text"))).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "recap text" },
    });
  });

  it("returns empty string for empty text (no injection)", () => {
    expect(renderRecapStdout("")).toBe("");
  });
});
