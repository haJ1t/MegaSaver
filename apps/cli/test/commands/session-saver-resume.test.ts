import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNetEffectRecord, writeNetEffectRecord } from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSaverResume } from "../../src/commands/session/saver/resume.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-resume-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

describe("mega session saver resume", () => {
  it("writes a resume override for the cwd workspace and reports it", () => {
    writeNetEffectRecord(store, encodeWorkspaceKey(process.cwd()), {
      savedTokens: 1,
      churnTokens: 99,
      verdict: "negative",
      updatedAt: "2026-07-19T12:00:00.000Z",
    });
    const lines: string[] = [];
    const code = runSaverResume({
      storeRoot: store,
      cwd: process.cwd(),
      stdout: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("resumed");
    expect(
      readNetEffectRecord(store, encodeWorkspaceKey(process.cwd()))?.resumeOverrideAt,
    ).toBeDefined();
  });

  it("no verdict record → explains there is nothing to resume, exit 0", () => {
    const lines: string[] = [];
    const code = runSaverResume({
      storeRoot: store,
      cwd: process.cwd(),
      stdout: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("no net-effect verdict");
  });
});
