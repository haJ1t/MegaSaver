import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAlertsFailures } from "../../src/commands/failures/index.js";

const NOW_MS = Date.parse("2026-08-06T12:00:00.000Z");
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

let store: string;
let cwd: string;
let out: string[];
let err: string[];

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-failures-report-store-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-failures-report-cwd-"));
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function seedFailingReceipt(over: Record<string, unknown> = {}): void {
  const wk = encodeWorkspaceKey(cwd);
  const dir = join(store, "stats", wk);
  mkdirSync(dir, { recursive: true });
  const row = {
    id: "evt-1",
    liveSessionId: "sess-a",
    workspaceKey: wk,
    createdAt: "2026-08-06T11:30:00.000Z",
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
  writeFileSync(join(dir, "sess-a.events.jsonl"), `${JSON.stringify(row)}\n`);
}

function base() {
  return {
    storeRoot: store,
    cwd,
    now: () => NOW_MS,
    stdinIsTty: true,
    readStdin: async () => "",
    json: false,
    strict: false,
    toolErrors: true,
    overflow: true,
    partial: true,
    hallucinated: true,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
  };
}

describe("runAlertsFailures", () => {
  it("--json is ALWAYS JSON, including the empty no-session case", async () => {
    expect(await runAlertsFailures({ ...base(), json: true })).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.status).toBe("silent-failure-report");
    expect(report.liveSessionId).toBeNull();
    expect(report.detectors).toHaveLength(4);
    expect(report.detectors.every((d: { verdict: string }) => d.verdict === "no-signal")).toBe(
      true,
    );
  });

  it("failing receipt → [tool-error] table line; --strict exits 1; default exits 0", async () => {
    seedFailingReceipt();
    expect(await runAlertsFailures(base())).toBe(0);
    expect(out.join("\n")).toContain("[tool-error]");
    out = [];
    expect(await runAlertsFailures({ ...base(), strict: true })).toBe(1);
  });

  it("each opt-out marks its detector disabled and mutes it under --strict", async () => {
    seedFailingReceipt();
    const code = await runAlertsFailures({
      ...base(),
      json: true,
      strict: true,
      toolErrors: false,
      partial: false,
    });
    expect(code).toBe(0); // remaining enabled detectors are no-signal, not findings
    const report = JSON.parse(out[0] as string);
    const byId = Object.fromEntries(report.detectors.map((d: { id: string }) => [d.id, d]));
    expect(byId["tool-error"].verdict).toBe("disabled");
    expect(byId["partial-completion"].verdict).toBe("disabled");

    out = [];
    expect(
      await runAlertsFailures({
        ...base(),
        json: true,
        strict: true,
        toolErrors: false,
        overflow: false,
        partial: false,
        hallucinated: false,
      }),
    ).toBe(0); // nothing enabled → nothing can be a finding
    const allOff = JSON.parse(out[0] as string);
    expect(allOff.detectors).toHaveLength(4);
    expect(allOff.detectors.every((d: { verdict: string }) => d.verdict === "disabled")).toBe(true);
  });

  it("usage errors: --days conflict and bad --window → stderr, empty stdout, exit 1", async () => {
    expect(await runAlertsFailures({ ...base(), days: "30" })).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("--days");
    err = [];
    for (const window of ["0", "1441", "abc", "1.5"]) {
      expect(await runAlertsFailures({ ...base(), window })).toBe(1);
    }
    expect(out).toHaveLength(0);
  });

  it("runs free — no entitlement, and a secret-bearing label is never echoed raw", async () => {
    seedFailingReceipt({ label: `export AWS_SECRET_ACCESS_KEY=${SECRET}` });
    expect(await runAlertsFailures(base())).toBe(0); // no license in this store
    expect(out.join("\n")).not.toContain(SECRET);
  });
});
