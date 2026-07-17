import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand } from "../src/commands/memory/create.js";
import { memoryUpdateCommand } from "../src/commands/memory/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID_PROJECT = "22222222-2222-4222-8222-222222222222";
const TS = "2026-07-17T00:00:00.000Z";

describe("memory create/update reserve the from-session ledger namespace", () => {
  let store: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-memreserved-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    delete process.env["MEGA_TEST_MEMORY_ENTRY_ID"];
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    delete process.env["MEGA_TEST_NOW"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    else process.env["NODE_ENV"] = originalNodeEnv;
    await rm(store, { recursive: true, force: true });
  });

  async function seedProjectOnly(): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await mkdir(join(store, "memory"), { recursive: true });
  }

  async function readMemoryJsonl(): Promise<Array<Record<string, unknown>>> {
    const path = join(store, "memory", `${PROJECT_ID}.jsonl`);
    const raw = await readFile(path, "utf8").catch(() => "");
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  }

  // Seeds a memory row directly on disk (bypassing `memory create`, which
  // itself strips reserved keywords) so the row can carry a genuine
  // ledger keyword the way an earlier autopilot/from-session capture would
  // have written it.
  async function seedRowWithReservedKeyword(keywords: string[]): Promise<void> {
    const row = {
      id: MEMORY_ID_PROJECT,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "seed row",
      content: "a real ledger-tagged memory",
      keywords,
      confidence: "high",
      source: "agent",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    };
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${JSON.stringify(row)}\n`);
  }

  async function runCreate(args: Record<string, unknown>): Promise<void> {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["NODE_ENV"] = "test";
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGA_TEST_MEMORY_ENTRY_ID"] = MEMORY_ID_PROJECT;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGA_TEST_NOW"] = TS;
    await memoryCreateCommand.run?.({
      args: { ...args, store },
      cmd: memoryCreateCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  async function runUpdate(args: Record<string, unknown>): Promise<void> {
    await memoryUpdateCommand.run?.({
      args: { ...args, store },
      cmd: memoryUpdateCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("create strips a reserved from-session keyword from agent input, keeps the rest", async () => {
    await seedProjectOnly();
    await runCreate({
      projectName: "demo",
      scope: "project",
      content: "user prefers TS",
      keyword: ["from-session:cccccccc-cccc-4ccc-8ccc-000000000002:73b5e6cebe082b46", "auth"],
    });
    expect(process.exitCode).toBe(0);
    const arr = await readMemoryJsonl();
    expect(arr).toHaveLength(1);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(arr[0]?.["keywords"]).toEqual(["auth"]);
  });

  it("update strips a forged from-session add and preserves the row's real ledger keyword", async () => {
    await seedProjectOnly();
    await seedRowWithReservedKeyword(["from-session:realfailure:deadbeef"]);

    await runUpdate({
      memoryEntryId: MEMORY_ID_PROJECT,
      keyword: ["from-session:forged:0000", "renamed"],
    });
    expect(process.exitCode).toBe(0);

    const arr = await readMemoryJsonl();
    expect(arr).toHaveLength(1);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const keywords = arr[0]?.["keywords"] as string[];
    expect(keywords).toContain("from-session:realfailure:deadbeef");
    expect(keywords).toContain("renamed");
    expect(keywords).not.toContain("from-session:forged:0000");
  });
});
