import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runOutputExec } from "../../src/commands/output/exec.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";

async function seed(store: string, projectRoot: string): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
    ]),
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
}

describe("runOutputExec — recursive_megasaver guard", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-exec-rec-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-exec-rec-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("inherited MEGASAVER_ORIGIN_PID (!= pid) → command_denied: recursive_megasaver, exit 1, never spawns", async () => {
    await seed(store, projectRoot);
    const out: string[] = [];
    const err: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: spawn test double
    const spawn = vi.fn(() => {
      throw new Error("spawn must never be called when the policy gate denies");
    }) as any;

    const code = await runOutputExec({
      sessionId: SESSION_ID,
      intentFlag: "anything",
      command: "pnpm",
      args: ["test"],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: false,
      // Simulates an inherited marker from a MegaSaver-orchestrated parent: a
      // pid that is not this process's pid → the child is downstream.
      originPid: "424242",
      spawn,
      now: () => "2026-05-10T12:00:00.000Z",
      newId: () => "cs-fixed-id",
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("command_denied: recursive_megasaver"))).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });
});
