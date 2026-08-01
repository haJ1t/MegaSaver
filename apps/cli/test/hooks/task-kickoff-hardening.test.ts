import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildIndex } from "@megasaver/indexer";
import { encodeWorkspaceKey } from "@megasaver/shared";
import * as taskKickoffStats from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasTaskKickoffClaim,
  readTaskKickoffPack,
  taskKickoffPackPath,
} from "../../src/hooks/task-kickoff-store.js";
import { buildTaskKickoffHookOutput } from "../../src/hooks/task-kickoff.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = Date.parse("2026-08-01T10:00:00.000Z");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const RETRY_EVENT_ID = "33333333-3333-4333-8333-333333333333";

let storeRoot: string;
let projectRoot: string;

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-hardening-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-hardening-project-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    join(projectRoot, "src", "auth.ts"),
    "export function repairAuth(token: string) {\n  return token.length > 0;\n}\n",
  );
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  } as never);
  await buildIndex({ rootDir: projectRoot, storeDir: storeRoot, projectId: PROJECT_ID as never });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

function input(sessionId: string, deadlineMs = 1_000) {
  return {
    payload: { prompt: "repair auth", cwd: projectRoot, session_id: sessionId },
    storeRoot,
    now: () => NOW,
    deadlineMs,
    count: async (text: string) => text.length,
    newId: () => EVENT_ID,
  };
}

function holdClaim(claimPath: string): Promise<() => Promise<void>> {
  const script = [
    'import { closeSync, mkdirSync, openSync, rmSync, utimesSync, writeSync } from "node:fs";',
    'import { dirname } from "node:path";',
    "const path = process.argv[1];",
    "mkdirSync(dirname(path), { recursive: true, mode: 0o700 });",
    'const descriptor = openSync(path, "wx", 0o600);',
    'writeSync(descriptor, JSON.stringify({ eventId: "22222222-2222-4222-8222-222222222222", createdAt: "2026-08-01T10:00:00.000Z" }));',
    "const old = new Date(Date.now() - 60_000);",
    "utimesSync(path, old, old);",
    'process.stdout.write("ready\\n");',
    'process.stdin.once("data", () => { closeSync(descriptor); rmSync(path, { force: true }); process.exit(0); });',
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, claimPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout !== "ready\n") return;
      resolve(
        () =>
          new Promise<void>((finish, fail) => {
            child.once("error", fail);
            child.once("close", (code) => {
              if (code === 0) finish();
              else fail(new Error(stderr));
            });
            child.stdin.end("release\n");
          }),
      );
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (stdout !== "ready\n") reject(new Error(`claim holder exited ${code}: ${stderr}`));
    });
  });
}

describe("task kickoff hardening", () => {
  it("accepts first-party envelope fields while still requiring prompt, cwd, and session_id", async () => {
    const output = await buildTaskKickoffHookOutput({
      ...input("envelope-fields"),
      payload: {
        prompt: "repair auth",
        cwd: projectRoot,
        session_id: "envelope-fields",
        hook_event_name: "UserPromptSubmit",
        transcript_path: "/tmp/session.jsonl",
        permission_mode: "default",
      },
    });

    expect(output).not.toBe("");
    await expect(
      buildTaskKickoffHookOutput({
        ...input("missing-session"),
        payload: { prompt: "repair auth", cwd: projectRoot },
      }),
    ).resolves.toBe("");
  });

  it("keeps the claim after a helper appends then throws, so a retry cannot duplicate", async () => {
    const append = taskKickoffStats.appendTaskKickoffEvent;
    vi.spyOn(taskKickoffStats, "appendTaskKickoffEvent").mockImplementationOnce((store, event) => {
      append(store, event);
      throw new Error("post-append permission failure");
    });
    const sessionId = "post-append";

    const first = await buildTaskKickoffHookOutput(input(sessionId));
    const retry = await buildTaskKickoffHookOutput(input(sessionId));

    const workspaceKey = encodeWorkspaceKey(projectRoot);
    expect(first).not.toBe("");
    expect(retry).toBe("");
    expect(readTaskKickoffPack(storeRoot, workspaceKey, sessionId)).toBeDefined();
    expect(taskKickoffStats.readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toHaveLength(
      1,
    );
  });

  it("recovers an eventless pre-event append error for a retry", async () => {
    const sessionId = "pre-event-error";
    const workspaceKey = encodeWorkspaceKey(projectRoot);
    vi.spyOn(taskKickoffStats, "appendTaskKickoffEvent").mockImplementationOnce(() => {
      throw new Error("pre-event permission failure");
    });

    const first = await buildTaskKickoffHookOutput(input(sessionId));
    const retry = await buildTaskKickoffHookOutput(input(sessionId));

    expect(first).toBe("");
    expect(retry).not.toBe("");
    expect(readTaskKickoffPack(storeRoot, workspaceKey, sessionId)).toBeDefined();
    expect(taskKickoffStats.readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toHaveLength(
      1,
    );
  });

  it("retracts a slow post-append event before retrying after its deadline", async () => {
    const append = taskKickoffStats.appendTaskKickoffEvent;
    vi.spyOn(taskKickoffStats, "appendTaskKickoffEvent").mockImplementationOnce((store, event) => {
      append(store, event);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
    });
    const sessionId = "post-append-deadline";
    const workspaceKey = encodeWorkspaceKey(projectRoot);

    const expired = await buildTaskKickoffHookOutput(input(sessionId, 500));

    expect(expired).toBe("");
    expect(readTaskKickoffPack(storeRoot, workspaceKey, sessionId)).toBeUndefined();
    expect(hasTaskKickoffClaim(storeRoot, workspaceKey, sessionId)).toBe(false);
    expect(taskKickoffStats.readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toEqual([]);

    const retry = await buildTaskKickoffHookOutput({
      ...input(sessionId),
      newId: () => RETRY_EVENT_ID,
    });

    expect(retry).not.toBe("");
    expect(taskKickoffStats.readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toHaveLength(
      1,
    );
  });

  it("fails closed when a post-append deadline retraction cannot be recorded", async () => {
    const append = taskKickoffStats.appendTaskKickoffEvent;
    vi.spyOn(taskKickoffStats, "appendTaskKickoffEvent").mockImplementationOnce((store, event) => {
      append(store, event);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
    });
    vi.spyOn(taskKickoffStats, "retractTaskKickoffEvent").mockImplementationOnce(() => {
      throw new Error("retraction write failed");
    });
    const sessionId = "post-append-retraction-failure";
    const workspaceKey = encodeWorkspaceKey(projectRoot);

    const expired = await buildTaskKickoffHookOutput(input(sessionId, 500));
    const retry = await buildTaskKickoffHookOutput(input(sessionId));

    expect(expired).toBe("");
    expect(retry).toBe("");
    expect(readTaskKickoffPack(storeRoot, workspaceKey, sessionId)).toBeDefined();
    expect(hasTaskKickoffClaim(storeRoot, workspaceKey, sessionId)).toBe(true);
    expect(taskKickoffStats.readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toHaveLength(
      1,
    );
  });

  it("does not steal an old-looking atomic claim held by a live child process", async () => {
    const sessionId = "live-child";
    const workspaceKey = encodeWorkspaceKey(projectRoot);
    const claimPath = `${taskKickoffPackPath(storeRoot, workspaceKey, sessionId)}.claim`;
    const release = await holdClaim(claimPath);
    try {
      await expect(buildTaskKickoffHookOutput(input(sessionId, 100))).resolves.toBe("");
      expect(readTaskKickoffPack(storeRoot, workspaceKey, sessionId)).toBeUndefined();
      expect(taskKickoffStats.readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toEqual([]);
    } finally {
      await release();
    }

    await expect(buildTaskKickoffHookOutput(input(sessionId))).resolves.not.toBe("");
    expect(taskKickoffStats.readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toHaveLength(
      1,
    );
  }, 10_000);

  it("returns by its configured deadline without writing a cache or event after slow git", async () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-hardening-bin-"));
    const fakeGit = join(fakeBin, "git");
    writeFileSync(
      fakeGit,
      `#!${process.execPath}\nsetTimeout(() => process.stdout.write(""), 5_000);\n`,
    );
    chmodSync(fakeGit, 0o700);
    // biome-ignore lint/complexity/useLiteralKeys: PATH is the executable lookup boundary.
    const originalPath = process.env["PATH"];
    // biome-ignore lint/complexity/useLiteralKeys: PATH is the executable lookup boundary.
    process.env["PATH"] = `${fakeBin}:${originalPath ?? ""}`;
    const sessionId = "slow-git-hardening";
    const deadlineMs = 25;
    try {
      const startedAt = performance.now();
      const output = await buildTaskKickoffHookOutput(input(sessionId, deadlineMs));
      const elapsedMs = performance.now() - startedAt;
      const workspaceKey = encodeWorkspaceKey(projectRoot);

      expect(output).toBe("");
      expect(elapsedMs).toBeLessThan(deadlineMs + 150);
      expect(readTaskKickoffPack(storeRoot, workspaceKey, sessionId)).toBeUndefined();
      expect(taskKickoffStats.readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toEqual([]);
    } finally {
      // biome-ignore lint/complexity/useLiteralKeys: PATH is the executable lookup boundary.
      process.env["PATH"] = originalPath;
      rmSync(fakeBin, { recursive: true, force: true });
    }
  }, 10_000);
});
