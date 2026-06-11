import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand } from "../src/commands/memory/create.js";
import { memoryDeleteCommand } from "../src/commands/memory/delete.js";
import { memoryExplainCommand } from "../src/commands/memory/explain.js";
import { memorySearchCommand } from "../src/commands/memory/search.js";
import { memoryUpdateCommand } from "../src/commands/memory/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

describe("mega memory — Phase 1 surface", () => {
  let store: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-memext-"));
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
  });

  const out = (): string[] => logSpy.mock.calls.map((c) => c[0] as string);
  const clear = (): void => {
    logSpy.mockClear();
    errSpy.mockClear();
  };

  // biome-ignore lint/suspicious/noExplicitAny: citty run() arg shape
  const run = (cmd: any, args: Record<string, unknown>): Promise<void> =>
    cmd.run({ args: { ...args, store }, cmd, rawArgs: [], data: undefined });

  async function createOne(args: Record<string, unknown>): Promise<string> {
    clear();
    await run(memoryCreateCommand, { projectName: "demo", scope: "project", ...args });
    expect(process.exitCode).toBe(0);
    return out()[0] as string;
  }

  it("create accepts typed flags and explain renders them", async () => {
    const id = await createOne({
      content: "use JWT middleware for protected routes",
      type: "decision",
      title: "JWT auth middleware",
      keyword: "auth",
      confidence: "high",
      source: "agent",
      reason: "centralize auth",
    });
    clear();
    await run(memoryExplainCommand, { memoryEntryId: id });
    expect(process.exitCode).toBe(0);
    const lines = out();
    const field = (key: string, value: string): boolean =>
      lines.some((l) => l.startsWith(key) && l.trimEnd().endsWith(value));
    expect(field("type", "decision")).toBe(true);
    expect(field("title", "JWT auth middleware")).toBe(true);
    expect(field("confidence", "high")).toBe(true);
    expect(field("source", "agent")).toBe(true);
    expect(field("keywords", "auth")).toBe(true);
  });

  it("create rejects an invalid type", async () => {
    clear();
    await run(memoryCreateCommand, {
      projectName: "demo",
      scope: "project",
      content: "x",
      type: "bogus",
    });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0] as string).join("\n")).toContain(
      'invalid type "bogus"',
    );
  });

  it("create rejects an invalid --expires and an empty --reason at the boundary", async () => {
    clear();
    await run(memoryCreateCommand, {
      projectName: "demo",
      scope: "project",
      content: "x",
      expires: "tomorrow",
    });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0] as string).join("\n")).toContain("invalid expires");

    process.exitCode = 0;
    clear();
    await run(memoryCreateCommand, {
      projectName: "demo",
      scope: "project",
      content: "x",
      reason: "   ",
    });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0] as string).join("\n")).toContain(
      "reason must not be empty",
    );
  });

  it("update rejects an invalid --expires at the boundary", async () => {
    const id = await createOne({ content: "x" });
    clear();
    await run(memoryUpdateCommand, { memoryEntryId: id, expires: "2026-13-99" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0] as string).join("\n")).toContain("invalid expires");
  });

  it("search ranks by query and filters by type", async () => {
    const authId = await createOne({
      content: "JWT auth middleware validates tokens",
      type: "decision",
      keyword: "auth",
    });
    await createOne({ content: "navbar sticky header styling", type: "code_pattern" });

    clear();
    await run(memorySearchCommand, { projectName: "demo", query: "auth tokens" });
    expect(process.exitCode).toBe(0);
    const firstLine = out()[0] as string;
    expect(firstLine).toContain(authId);
    expect(firstLine).toContain("decision");

    clear();
    await run(memorySearchCommand, { projectName: "demo", type: "code_pattern" });
    expect(process.exitCode).toBe(0);
    expect(out().every((l) => l.includes("code_pattern"))).toBe(true);
  });

  it("update patches fields; stale entries drop out of default search", async () => {
    const id = await createOne({
      content: "deprecated approach",
      type: "decision",
      keyword: "legacy",
    });

    clear();
    await run(memoryUpdateCommand, { memoryEntryId: id, confidence: "low", stale: true });
    expect(process.exitCode).toBe(0);

    clear();
    await run(memorySearchCommand, { projectName: "demo", query: "deprecated" });
    expect(process.exitCode).toBe(0);
    expect(out()).toHaveLength(0);

    clear();
    await run(memorySearchCommand, {
      projectName: "demo",
      query: "deprecated",
      "include-stale": true,
    });
    expect(process.exitCode).toBe(0);
    expect((out()[0] as string) ?? "").toContain(id);
  });

  it("update with no fields errors", async () => {
    const id = await createOne({ content: "x" });
    clear();
    await run(memoryUpdateCommand, { memoryEntryId: id });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0] as string).join("\n")).toContain("nothing to update");
  });

  it("delete requires --yes, then removes the entry", async () => {
    const id = await createOne({ content: "doomed entry" });

    clear();
    await run(memoryDeleteCommand, { memoryEntryId: id });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0] as string).join("\n")).toContain("--yes");

    process.exitCode = 0;
    clear();
    await run(memoryDeleteCommand, { memoryEntryId: id, yes: true });
    expect(process.exitCode).toBe(0);

    clear();
    await run(memoryExplainCommand, { memoryEntryId: id });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0] as string).join("\n")).toContain("not found");
  });
});
