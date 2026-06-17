import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force upsertBlock to emit a NON-conformant string (no managed block) so the
// projectionPreflight call site in sync.ts is exercised. A real upsertBlock is
// always conformant, so mocking it is the only way to prove that the preflight
// guard at the call site actually aborts the write and leaves disk unchanged
// (defense-in-depth against a future renderer/merge regression).
vi.mock("@megasaver/connectors-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@megasaver/connectors-shared")>();
  return { ...actual, upsertBlock: () => "garbage output with no managed block\n" };
});

import { connectorSyncCommand } from "../src/commands/connector/index.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("connector sync — projection preflight call-site abort", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-preflight-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-preflight-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProject(): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function runSync(): Promise<void> {
    await connectorSyncCommand.run?.({
      args: { projectName: "demo", store },
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("aborts the write and leaves the file unchanged when the projection is non-conformant", async () => {
    await seedProject();
    const original = "# my notes\nuser content outside any block\n";
    await writeFile(join(projectRoot, "CLAUDE.md"), original);

    await runSync();

    expect(process.exitCode).toBe(1);
    // The non-conformant projection never reached disk.
    expect(await readFile(join(projectRoot, "CLAUDE.md"), "utf8")).toBe(original);
    // The CLI surfaces the projection_invalid message for the target.
    expect(
      errSpy.mock.calls.some((c) =>
        String(c[0]).includes("connector projection invalid for CLAUDE.md"),
      ),
    ).toBe(true);
  });
});
