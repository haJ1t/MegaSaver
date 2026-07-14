import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand, runMemoryCreate } from "../../src/commands/memory/create.js";
import { runMemoryUpdate } from "../../src/commands/memory/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SEED_ID = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";

type StoredRow = {
  id: string;
  relatedFiles?: string[];
  relatedSymbols?: string[];
  lastActiveAt?: string;
};

describe("mega memory create/update --symbol", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-symbol-flag-"));
    lines.length = 0;
    errLines.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
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
  });

  async function seedStore(): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
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
    };
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${JSON.stringify(seed)}\n`);
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
      contentFlag: "use zod at boundaries",
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

  function makeUpdateInput(
    over: Partial<Parameters<typeof runMemoryUpdate>[0]>,
  ): Parameters<typeof runMemoryUpdate>[0] {
    return {
      memoryEntryId: SEED_ID,
      typeFlag: undefined,
      titleFlag: undefined,
      contentFlag: undefined,
      confidenceFlag: undefined,
      sourceFlag: undefined,
      reasonFlag: undefined,
      goalFlag: undefined,
      keywordFlags: undefined,
      fileFlags: undefined,
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
      ...over,
    };
  }

  it("create persists --symbol values as relatedSymbols", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeCreateInput({
        fileFlags: ["src/auth.ts"],
        symbolFlags: ["src/auth.ts#verifyToken", "helper"],
      }),
    );
    expect(code).toBe(0);
    const rows = await readRows();
    const created = rows.find((r) => r.id === NEW_ID);
    expect(created?.relatedSymbols).toEqual(["src/auth.ts#verifyToken", "helper"]);
  });

  it("citty parse path: a single --symbol survives as a one-element array", async () => {
    await seedStore();
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
        "use zod at boundaries",
        "--symbol",
        "verifyToken",
        "--store",
        store,
      ],
    });
    expect(process.exitCode).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === NEW_ID)?.relatedSymbols).toEqual(["verifyToken"]);
  });

  it("update replaces relatedSymbols and refreshes the decay anchor", async () => {
    await seedStore();
    const code = await runMemoryUpdate(makeUpdateInput({ symbolFlags: ["a#x", "y"] }));
    expect(code).toBe(0);
    const rows = await readRows();
    const updated = rows.find((r) => r.id === SEED_ID);
    expect(updated?.relatedSymbols).toEqual(["a#x", "y"]);
    // symbols are content-bearing: lastActiveAt re-keys decay (i1 pattern)
    expect(updated?.lastActiveAt).toBe(NOW);
  });
});
