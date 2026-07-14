import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryCreate } from "../../src/commands/memory/create.js";
import { memoryCommand } from "../../src/commands/memory/index.js";
import { MEMORY_VERIFY_UPSELL, runMemoryVerify } from "../../src/commands/memory/verify.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const UNANCHORED_ID = "66666666-6666-4666-8666-666666666666";
const TS = "2026-07-01T00:00:00.000Z";
const T_CREATE = "2026-07-02T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const FOO_V1 = "export function foo(): number {\n  return 1;\n}\n";
const FOO_V2 = "export function foo(): number {\n  return 2;\n}\n";

let store: string;
let repo: string;
let lines: string[];
let errLines: string[];

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-verify-store-"));
  repo = await mkdtemp(join(tmpdir(), "megasaver-verify-repo-"));
  lines = [];
  errLines = [];
  git(["init"], repo);
  git(["config", "user.email", "t@t"], repo);
  git(["config", "user.name", "t"], repo);
  await writeFile(join(repo, "a.ts"), FOO_V1);
  git(["add", "."], repo);
  git(["commit", "-m", "add a"], repo);
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

function memRow(id: string): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "unanchored row",
    content: "unanchored row",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
}

async function seedStore(rootPath: string, memoryRows: string[]): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([{ id: PROJECT_ID, name: "demo", rootPath, createdAt: TS, updatedAt: TS }]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
  if (memoryRows.length > 0) {
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${memoryRows.join("\n")}\n`);
  }
}

function verifyInput(
  over: Partial<Parameters<typeof runMemoryVerify>[0]> = {},
): Parameters<typeof runMemoryVerify>[0] {
  return {
    projectId: PROJECT_ID,
    changedFlag: false,
    quietFlag: false,
    jsonFlag: false,
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (line) => lines.push(line),
    stderr: (line) => errLines.push(line),
    now: () => NOW,
    ...over,
  };
}

async function createAnchored(): Promise<void> {
  const code = await runMemoryCreate({
    projectName: "demo",
    scopeFlag: "project",
    contentFlag: "foo returns 1",
    sessionFlag: undefined,
    fileFlags: ["a.ts"],
    symbolFlags: ["foo"],
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: () => {},
    stderr: () => {},
    newId: () => ENTRY_ID,
    now: () => T_CREATE,
  });
  expect(code).toBe(0);
}

describe("mega memory verify", () => {
  it("is registered as a memory subcommand", () => {
    const sub = (memoryCommand as { subCommands?: Record<string, unknown> }).subCommands ?? {};
    expect(Object.keys(sub)).toContain("verify");
  });

  it("counts unanchored rows and exits 0", async () => {
    await seedStore(repo, [memRow(UNANCHORED_ID)]);
    const code = await runMemoryVerify(verifyInput());
    expect(code).toBe(0);
    expect(lines[0]).toBe("0 contradicted, 0 healed, 0 verified, 1 unanchored, 0 repointed");
  });

  it("WOW loop: contradiction is reported with the upsell, then heals", async () => {
    await seedStore(repo, []);
    await createAnchored();

    let code = await runMemoryVerify(verifyInput());
    expect(code).toBe(0);
    expect(lines[0]).toBe("0 contradicted, 0 healed, 1 verified, 0 unanchored, 0 repointed");

    lines = [];
    errLines = [];
    await writeFile(join(repo, "a.ts"), FOO_V2);
    git(["add", "."], repo);
    git(["commit", "-m", "change foo"], repo);

    code = await runMemoryVerify(verifyInput());
    expect(code).toBe(0);
    expect(lines[0]).toBe("1 contradicted, 0 healed, 0 verified, 0 unanchored, 0 repointed");
    expect(lines.slice(1).join("\n")).toContain(`contradicted ${ENTRY_ID}`);
    expect(errLines).toContain(MEMORY_VERIFY_UPSELL);

    lines = [];
    errLines = [];
    await writeFile(join(repo, "a.ts"), FOO_V1);
    git(["add", "."], repo);
    git(["commit", "-m", "revert foo"], repo);

    code = await runMemoryVerify(verifyInput());
    expect(code).toBe(0);
    expect(lines[0]).toBe("0 contradicted, 1 healed, 0 verified, 0 unanchored, 0 repointed");
    expect(lines.slice(1).join("\n")).toContain(`healed ${ENTRY_ID}`);
  });

  it("--json emits the machine plan shape", async () => {
    await seedStore(repo, [memRow(UNANCHORED_ID)]);
    const code = await runMemoryVerify(verifyInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("")) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "contradicted",
      "healed",
      "repointed",
      "unanchored",
      "verified",
    ]);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    expect(parsed["unanchored"]).toEqual([UNANCHORED_ID]);
  });

  it("--quiet prints nothing when nothing flipped", async () => {
    await seedStore(repo, [memRow(UNANCHORED_ID)]);
    const code = await runMemoryVerify(verifyInput({ quietFlag: true }));
    expect(code).toBe(0);
    expect(lines).toEqual([]);
  });

  it("rejects a malformed project id with exit 1", async () => {
    await seedStore(repo, []);
    const code = await runMemoryVerify(verifyInput({ projectId: "not-a-uuid" }));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("invalid project id");
  });
});
