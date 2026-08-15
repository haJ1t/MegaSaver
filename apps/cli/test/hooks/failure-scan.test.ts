import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFailureScanHookFromProcess } from "../../src/hooks/failure-scan-run.js";

const NOW_MS = Date.parse("2026-08-06T12:00:00.000Z");
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

let store: string;
let cwd: string;
let out: string[];

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-failure-scan-store-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-failure-scan-cwd-"));
  out = [];
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function receipt(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-1",
    liveSessionId: "sess-a",
    workspaceKey: encodeWorkspaceKey(cwd),
    createdAt: "2026-08-06T11:55:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 100,
    returnedBytes: 40,
    bytesSaved: 60,
    savingRatio: 0.6,
    summary: "1 kept",
    childExitCode: 2,
    ...over,
  };
}

function seedRows(rows: ReadonlyArray<Record<string, unknown>>): void {
  const dir = join(store, "stats", encodeWorkspaceKey(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "sess-a.events.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

async function run(stdinText: string): Promise<number> {
  return runFailureScanHookFromProcess({
    storeRoot: store,
    stdin: async () => stdinText,
    stdout: (l) => out.push(l),
    nowMs: () => NOW_MS,
  });
}

const payload = (): string => JSON.stringify({ session_id: "sess-a", cwd });

describe("runFailureScanHookFromProcess", () => {
  it("(a) unresolved failing receipt → one Stop envelope, never a decision", async () => {
    seedRows([receipt()]);
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] as string);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("Stop");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("1");
    expect(parsed.decision).toBeUndefined();
  });

  it("(b) failing receipt resolved by a later exit-0 receipt → silent", async () => {
    seedRows([
      receipt(),
      receipt({ id: "evt-2", createdAt: "2026-08-06T11:56:00.000Z", childExitCode: 0 }),
    ]);
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("(c) no recorded receipts at all → silent (the gate's territory — disjoint)", async () => {
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("(d) rows without childExitCode only → silent (pre-gate rows excluded)", async () => {
    seedRows([receipt({ childExitCode: undefined })]); // JSON.stringify drops undefined
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("(e) malformed stdin → silent, still exit 0", async () => {
    seedRows([receipt()]);
    expect(await run("not json")).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("(f) a secret-bearing label appears only redacted in additionalContext", async () => {
    seedRows([receipt({ label: `export AWS_SECRET_ACCESS_KEY=${SECRET}` })]);
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(1);
    expect(out.join("\n")).not.toContain(SECRET);
  });
});
