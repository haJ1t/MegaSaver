import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryShowCommand } from "../src/commands/memory/show.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID_PROJECT = "22222222-2222-4222-8222-222222222222";
const MEMORY_ID_SESSION = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-05-09T00:00:00.000Z";

describe("memoryShowCommand", () => {
  let store: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-memshow-"));
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

  async function seed(): Promise<void> {
    await mkdir(store, { recursive: true });
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    // Memory entries are stored as JSONL per-project: memory/<projectId>.jsonl
    const projectEntry = JSON.stringify({
      id: MEMORY_ID_PROJECT,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "user prefers TS",
      createdAt: TS,
    });
    const sessionEntry = JSON.stringify({
      id: MEMORY_ID_SESSION,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      scope: "session",
      content: "checked CSRF token expiry",
      createdAt: TS,
    });
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${projectEntry}\n${sessionEntry}\n`,
    );
  }

  async function runShow(args: { memoryEntryId: string }): Promise<void> {
    await memoryShowCommand.run?.({
      args: { memoryEntryId: args.memoryEntryId, store },
      cmd: memoryShowCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("renders project-scoped entry as 6-line key=value", async () => {
    await seed();
    await runShow({ memoryEntryId: MEMORY_ID_PROJECT });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([
      `id          ${MEMORY_ID_PROJECT}`,
      `project     ${PROJECT_ID}`,
      "session     -",
      "scope       project",
      "content     user prefers TS",
      `createdAt   ${TS}`,
    ]);
  });

  it("renders session-scoped entry with full session UUID", async () => {
    await seed();
    await runShow({ memoryEntryId: MEMORY_ID_SESSION });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[2]).toBe(`session     ${SESSION_ID}`);
    expect(lines[3]).toBe("scope       session");
  });

  it("rejects unknown memory entry id with not-found", async () => {
    await seed();
    await runShow({ memoryEntryId: "99999999-9999-4999-8999-999999999999" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => /memory entry "99999999.*" not found/.test(c[0] as string)),
    ).toBe(true);
  });

  it("rejects invalid memory entry id (not a uuid)", async () => {
    await seed();
    await runShow({ memoryEntryId: "not-a-uuid" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
