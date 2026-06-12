import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AuditEvent, appendAuditEvent } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAuditExport } from "../src/commands/audit/export.js";
import { runAuditReport } from "../src/commands/audit/report.js";

let root: string;
const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-audit-"));
  lines.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function env() {
  return {
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined as string | undefined,
    platform: process.platform as NodeJS.Platform,
    localAppData: undefined as string | undefined,
  };
}

describe("mega audit export", () => {
  it("rejects a non-json --format with exit 1", async () => {
    const code = await runAuditExport({
      projectName: "demo",
      formatFlag: "csv",
      windowFlag: undefined,
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      now: () => "2026-06-12T12:00:00.000Z",
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("invalid format");
  });
});

describe("mega audit report", () => {
  it("rejects a bad --window with exit 1", async () => {
    const code = await runAuditReport({
      projectName: "demo",
      windowFlag: "year",
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      json: false,
      now: () => "2026-06-12T12:00:00.000Z",
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("invalid window");
  });
});
