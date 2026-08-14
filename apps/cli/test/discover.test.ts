import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDiscover, toDiscoverJson } from "../src/commands/discover.js";

let root: string;
let cwd: string;
let out: string[];
let err: string[];

const baseInput = () => ({
  storeFlag: root,
  cwd,
  home: root,
  xdgDataHome: undefined,
  platform: "darwin" as NodeJS.Platform,
  localAppData: undefined,
  stdout: (line: string) => out.push(line),
  stderr: (line: string) => err.push(line),
  json: false,
});

async function writeHookLog(lines: object[]): Promise<void> {
  const dir = join(cwd, ".megasaver", "hooks");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "claude-tool-calls.jsonl"),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "megasaver-discover-store-"));
  cwd = await mkdtemp(join(tmpdir(), "megasaver-discover-cwd-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("runDiscover", () => {
  it("missing hook log -> hint, exit 0, no numbers", async () => {
    const code = await runDiscover({ ...baseInput(), resolveActivation: () => null });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("mega hooks install claude-code");
  });

  it("disabled workspace groups all calls with the enable remediation", async () => {
    const target = join(cwd, "small.ts");
    await writeFile(target, "x".repeat(2_000));
    await writeHookLog([
      {
        timestamp: "2026-08-13T10:00:00.000Z",
        agent: "claude-code",
        tool: "Read",
        category: "eligible_read",
        filePath: target,
      },
      {
        timestamp: "2026-08-13T10:00:01.000Z",
        agent: "claude-code",
        tool: "Bash",
        category: "eligible_command",
      },
    ]);
    const code = await runDiscover({ ...baseInput(), resolveActivation: () => null });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("workspace disabled");
    expect(text).toContain("2000 B measured");
    expect(text).toContain("fix: mega session saver workspace enable");
    expect(text).toContain("(est.");
  });

  it("renders top repeated reads under below_floor", async () => {
    const target = join(cwd, "hot.ts");
    await writeFile(target, "x".repeat(1_000));
    await writeHookLog([
      {
        timestamp: "2026-08-13T10:00:00.000Z",
        agent: "claude-code",
        tool: "Read",
        category: "eligible_read",
        filePath: target,
      },
      {
        timestamp: "2026-08-13T10:00:01.000Z",
        agent: "claude-code",
        tool: "Read",
        category: "eligible_read",
        filePath: target,
      },
    ]);
    const code = await runDiscover({
      ...baseInput(),
      resolveActivation: () => ({ enabled: true, mode: "safe" as const }),
    });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("hot.ts");
    expect(text).toContain("2 calls");
  });

  it("--json emits one parseable line matching the JSON contract", async () => {
    const target = join(cwd, "small.ts");
    await writeFile(target, "x".repeat(1_000));
    await writeHookLog([
      {
        timestamp: "2026-08-13T10:00:00.000Z",
        agent: "claude-code",
        tool: "Read",
        category: "eligible_read",
        filePath: target,
      },
    ]);
    const code = await runDiscover({
      ...baseInput(),
      json: true,
      resolveActivation: () => ({ enabled: true, mode: "safe" as const }),
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0] ?? "") as Record<string, unknown>;
    expect(report.groups).toBeInstanceOf(Array);
    const g = (report.groups as Array<Record<string, unknown>>)[0];
    expect(g?.cause).toBe("below_floor");
    expect(g?.measuredBytes).toBe(1_000);
    expect(Object.keys(g ?? {}).sort()).toEqual([
      "calls",
      "cause",
      "caveat",
      "measuredBytes",
      "remediation",
      "topFiles",
      "uniqueFiles",
    ]);
    expect(report).not.toHaveProperty("hookLogPresent");
    expect(report).not.toHaveProperty("estTokens");
    expect(report.hookMissing).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/usd|dollar|price|\$/i);
    expect(typeof report.generatedAt).toBe("string");
  });
});

describe("toDiscoverJson", () => {
  it("missing hook log emits hookMissing true", () => {
    const report = {
      hookLogPresent: false,
      saverEnabled: false,
      mode: null,
      window: null,
      groups: [],
      aboveFloor: null,
      unmeasuredCalls: 0,
      mediated: { execRewrite: null, postToolUse: null },
      hint: "h",
    };
    const parsed = JSON.parse(toDiscoverJson(report, () => "fixed-ts")) as Record<string, unknown>;
    expect(parsed.hookMissing).toBe(true);
    expect(parsed).not.toHaveProperty("hint");
  });

  it("count-only groups emit measuredBytes null; now() is injectable", () => {
    const report = {
      hookLogPresent: true,
      saverEnabled: true,
      mode: "safe" as const,
      window: null,
      groups: [
        {
          cause: "command_unmeasured" as const,
          calls: 3,
          measuredCalls: 0,
          measuredBytes: 0,
          estTokens: 0,
          unmeasuredCalls: 3,
          uniqueFiles: 0,
          topFiles: [],
          remediation: null,
          caveat: "c",
        },
      ],
      aboveFloor: null,
      unmeasuredCalls: 0,
      mediated: { execRewrite: null, postToolUse: null },
      hint: null,
    };
    const parsed = JSON.parse(toDiscoverJson(report, () => "fixed-ts")) as Record<string, unknown>;
    const g = (parsed.groups as Array<Record<string, unknown>>)[0];
    expect(g?.measuredBytes).toBeNull();
    expect(g?.remediation).toBeNull();
    expect(parsed.generatedAt).toBe("fixed-ts");
  });
});
