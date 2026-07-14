import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand, runMemoryCreate } from "../../src/commands/memory/create.js";
import { runMemoryFromSession } from "../../src/commands/memory/from-session.js";
import { runMemoryUpdate } from "../../src/commands/memory/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SEED_ID = "33333333-3333-4333-8333-333333333333";
const FA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const SHA40 = /^[0-9a-f]{40}$/;

type StoredRow = {
  id: string;
  source?: string;
  anchor?: {
    repoHead: string;
    capturedAt: string;
    files: Array<{ path: string; blobSha: string }>;
    symbols: Array<{ path: string; name: string; contentHash: string }>;
  };
};

describe("anchor capture on CLI writers", () => {
  let store: string;
  let repo: string;
  const lines: string[] = [];
  const errLines: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
  const originalNodeEnv = process.env["NODE_ENV"];

  function git(args: string[], cwd: string): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  }

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-anchor-store-"));
    repo = await mkdtemp(join(tmpdir(), "megasaver-anchor-repo-"));
    lines.length = 0;
    errLines.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    git(["init"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    await writeFile(join(repo, "a.ts"), "export function foo(): number {\n  return 1;\n}\n");
    git(["add", "."], repo);
    git(["commit", "-m", "add a"], repo);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_MEMORY_ENTRY_ID"];
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_NOW"];
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    else process.env["NODE_ENV"] = originalNodeEnv;
    await rm(store, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  async function seedStore(
    rootPath: string,
    withFailure = false,
    seedAnchor?: Record<string, unknown>,
  ): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([{ id: PROJECT_ID, name: "demo", rootPath, createdAt: TS, updatedAt: TS }]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: "demo session",
          startedAt: TS,
          endedAt: null,
        },
      ]),
    );
    const seed = {
      id: SEED_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "seed",
      content: "seed",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
      ...(seedAnchor ? { relatedFiles: ["a.ts"], anchor: seedAnchor } : {}),
    };
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${JSON.stringify(seed)}\n`);
    if (withFailure) {
      await mkdir(join(store, "failed-attempts"), { recursive: true });
      const failure = {
        id: FA_ID,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        task: "fix foo",
        failedStep: "run tests",
        relatedFiles: ["a.ts"],
        convertedToRule: false,
        createdAt: TS,
      };
      await writeFile(
        join(store, "failed-attempts", `${PROJECT_ID}.jsonl`),
        `${JSON.stringify(failure)}\n`,
      );
    }
  }

  async function readRows(): Promise<StoredRow[]> {
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as StoredRow);
  }

  function makeCreateInput(
    over: Partial<Parameters<typeof runMemoryCreate>[0]>,
  ): Parameters<typeof runMemoryCreate>[0] {
    return {
      projectName: "demo",
      scopeFlag: "project",
      contentFlag: "foo returns 1",
      sessionFlag: undefined,
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      newId: () => NEW_ID,
      now: () => NOW,
      ...over,
    };
  }

  it("create captures an anchor when files/symbols are cited in a git repo", async () => {
    await seedStore(repo);
    const code = await runMemoryCreate(
      makeCreateInput({ fileFlags: ["a.ts"], symbolFlags: ["foo"] }),
    );
    expect(code).toBe(0);
    const created = (await readRows()).find((r) => r.id === NEW_ID);
    expect(created?.anchor).toBeDefined();
    expect(created?.anchor?.repoHead).toMatch(SHA40);
    expect(created?.anchor?.files).toEqual([
      { path: "a.ts", blobSha: expect.stringMatching(SHA40) },
    ]);
    expect(created?.anchor?.symbols[0]?.name).toBe("foo");
    expect(created?.anchor?.symbols[0]?.path).toBe("a.ts");
  });

  it("citty parse path: --no-anchor skips capture", async () => {
    await seedStore(repo);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["NODE_ENV"] = "test";
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_MEMORY_ENTRY_ID"] = NEW_ID;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_NOW"] = NOW;
    await runCommand(memoryCreateCommand, {
      rawArgs: [
        "demo",
        "--scope",
        "project",
        "--content",
        "foo returns 1",
        "--file",
        "a.ts",
        "--no-anchor",
        "--store",
        store,
      ],
    });
    expect(process.exitCode).toBe(0);
    const created = (await readRows()).find((r) => r.id === NEW_ID);
    expect(created).toBeDefined();
    expect(created?.anchor).toBeUndefined();
  });

  it("non-git project root degrades to an unanchored save", async () => {
    await seedStore(store); // the store dir is not a git repo
    const code = await runMemoryCreate(makeCreateInput({ fileFlags: ["a.ts"] }));
    expect(code).toBe(0);
    const created = (await readRows()).find((r) => r.id === NEW_ID);
    expect(created).toBeDefined();
    expect(created?.anchor).toBeUndefined();
  });

  it("update re-captures when --file changes", async () => {
    await seedStore(repo);
    const code = await runMemoryUpdate({
      memoryEntryId: SEED_ID,
      typeFlag: undefined,
      titleFlag: undefined,
      contentFlag: undefined,
      confidenceFlag: undefined,
      sourceFlag: undefined,
      reasonFlag: undefined,
      goalFlag: undefined,
      keywordFlags: undefined,
      fileFlags: ["a.ts"],
      symbolFlags: ["foo"],
      staleFlag: undefined,
      expiresFlag: undefined,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      now: () => NOW,
    });
    expect(code).toBe(0);
    const updated = (await readRows()).find((r) => r.id === SEED_ID);
    expect(updated?.anchor).toBeDefined();
    expect(updated?.anchor?.symbols[0]?.name).toBe("foo");
  });

  it("update leaves the stored anchor untouched when re-capture fails", async () => {
    const original = {
      repoHead: "0000000000000000000000000000000000000000",
      capturedAt: TS,
      files: [{ path: "a.ts", blobSha: "1111111111111111111111111111111111111111" }],
      symbols: [{ path: "a.ts", name: "foo", startLine: 1, endLine: 3, contentHash: "deadbeef" }],
    };
    // Project root is the non-git store dir, so re-capture returns undefined.
    await seedStore(store, false, original);
    const code = await runMemoryUpdate({
      memoryEntryId: SEED_ID,
      typeFlag: undefined,
      titleFlag: undefined,
      contentFlag: undefined,
      confidenceFlag: undefined,
      sourceFlag: undefined,
      reasonFlag: undefined,
      goalFlag: undefined,
      keywordFlags: undefined,
      fileFlags: ["b.ts"],
      symbolFlags: undefined,
      staleFlag: undefined,
      expiresFlag: undefined,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      now: () => NOW,
    });
    expect(code).toBe(0);
    const updated = (await readRows()).find((r) => r.id === SEED_ID);
    // Failed re-capture must NOT overwrite the anchor with undefined (§5.1).
    expect(updated?.anchor).toEqual(original);
  });

  it("from-session captures anchors for candidates that cite files", async () => {
    await seedStore(repo, true);
    const code = await runMemoryFromSession({
      sessionId: SESSION_ID,
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      jsonFlag: false,
      now: NOW,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
    } as Parameters<typeof runMemoryFromSession>[0]);
    expect(code).toBe(0);
    const rows = await readRows();
    const extracted = rows.find((r) => r.id !== SEED_ID && r.anchor !== undefined);
    expect(extracted).toBeDefined();
    expect(extracted?.anchor?.files[0]?.path).toBe("a.ts");
  });
});
