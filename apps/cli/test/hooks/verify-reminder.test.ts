import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildVerifyReminder,
  runVerifyReminderHookFromProcess,
} from "../../src/hooks/verify-reminder-run.js";

const LSID = "33333333-3333-4333-8333-333333333333";
const NOW_MS = Date.parse("2026-08-06T12:00:00.000Z");

let store: string;
let cwd: string;
const out: string[] = [];

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-verify-hook-store-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-verify-hook-cwd-"));
  out.length = 0;
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function seedOverlayReceipt(createdAt: string): void {
  const wk = encodeWorkspaceKey(cwd);
  const dir = join(store, "stats", wk);
  mkdirSync(dir, { recursive: true });
  const row = {
    id: "evt-1",
    liveSessionId: LSID,
    workspaceKey: wk,
    createdAt,
    sourceKind: "command",
    label: "grep error",
    rawBytes: 100,
    returnedBytes: 40,
    bytesSaved: 60,
    savingRatio: 0.6,
    summary: "1 kept",
    childExitCode: 0,
  };
  writeFileSync(join(dir, `${LSID}.events.jsonl`), `${JSON.stringify(row)}\n`);
}

describe("verify-reminder Stop hook", () => {
  it("stays silent when an in-window exec receipt exists", async () => {
    seedOverlayReceipt("2026-08-06T11:50:00.000Z");
    const code = await runVerifyReminderHookFromProcess({
      storeRoot: store,
      stdin: async () => JSON.stringify({ session_id: LSID, cwd }),
      stdout: (line) => out.push(line),
      nowMs: () => NOW_MS,
    });
    expect(code).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("emits a warn-only additionalContext reminder when no receipt exists", async () => {
    const code = await runVerifyReminderHookFromProcess({
      storeRoot: store,
      stdin: async () => JSON.stringify({ session_id: LSID, cwd }),
      stdout: (line) => out.push(line),
      nowMs: () => NOW_MS,
    });
    expect(code).toBe(0);
    const doc = JSON.parse(out[0] ?? "{}") as {
      hookSpecificOutput?: { hookEventName: string; additionalContext: string };
      decision?: string;
    };
    expect(doc.hookSpecificOutput?.hookEventName).toBe("Stop");
    expect(doc.hookSpecificOutput?.additionalContext).toContain("mega output exec");
    expect(doc.decision).toBeUndefined(); // NEVER blocking
  });

  it("fails open: malformed stdin prints nothing and still returns 0", async () => {
    const code = await runVerifyReminderHookFromProcess({
      storeRoot: store,
      stdin: async () => "not json",
      stdout: (line) => out.push(line),
      nowMs: () => NOW_MS,
    });
    expect(code).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("buildVerifyReminder ignores out-of-window and non-command events", () => {
    const reminder = buildVerifyReminder({
      events: [
        {
          sourceKind: "command",
          createdAt: "2026-08-06T10:00:00.000Z",
        } as never,
        { sourceKind: "file", createdAt: "2026-08-06T11:59:00.000Z" } as never,
      ],
      nowMs: NOW_MS,
      windowMinutes: 30,
    });
    expect(reminder).toBeDefined();
  });
});
