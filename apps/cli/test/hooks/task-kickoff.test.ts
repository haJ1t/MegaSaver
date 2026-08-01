import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "@megasaver/indexer";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { readTaskKickoffEvents, taskKickoffEventPath } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProjectContextPack } from "../../src/commands/context/shared.js";
import { readTaskKickoffPack } from "../../src/hooks/task-kickoff-store.js";
import { buildTaskKickoffHookOutput } from "../../src/hooks/task-kickoff.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = Date.parse("2026-08-01T10:00:00.000Z");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

let storeRoot: string;
let projectRoot: string;

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-project-"));
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
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("buildProjectContextPack", () => {
  it("returns indexed candidates as metadata without source bodies", async () => {
    const { registry } = await ensureStoreReady(storeRoot);
    const project = registry.getProject(PROJECT_ID as never);
    if (project === null) throw new Error("project fixture missing");

    const pack = await buildProjectContextPack({
      project,
      registry,
      rootDir: storeRoot,
      task: "repair auth",
    });

    expect(pack?.included).toHaveLength(1);
    expect(Object.keys(pack?.included[0] ?? {}).sort()).toEqual([
      "blockId",
      "blockType",
      "endLine",
      "factors",
      "filePath",
      "name",
      "reasons",
      "score",
      "startLine",
    ]);
    expect(pack?.included[0]).not.toHaveProperty("content");
    expect(pack?.included[0]).not.toHaveProperty("summary");
  });
});

describe("buildTaskKickoffHookOutput", () => {
  const payload = () => ({ prompt: "repair auth", cwd: projectRoot, session_id: "session-1" });
  const count = async (text: string) => text.length;
  const input = () => ({
    payload: payload(),
    storeRoot,
    now: () => NOW,
    deadlineMs: 1_000,
    count,
    newId: () => EVENT_ID,
  });

  it("emits once when the same session moves from the project root to a nested cwd", async () => {
    let countCalls = 0;
    const countedInput = {
      ...input(),
      count: async (text: string) => {
        countCalls += 1;
        return text.length;
      },
    };
    const first = await buildTaskKickoffHookOutput(countedInput);
    const callsAfterFirst = countCalls;
    const second = await buildTaskKickoffHookOutput({
      ...countedInput,
      payload: { ...payload(), cwd: join(projectRoot, "src"), prompt: "another prompt" },
    });

    const parsed = JSON.parse(first) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput).toMatchObject({ hookEventName: "UserPromptSubmit" });
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Task: repair auth");
    expect(second).toBe("");
    expect(countCalls).toBe(callsAfterFirst);

    const workspaceKey = encodeWorkspaceKey(projectRoot);
    const stored = readTaskKickoffPack(storeRoot, workspaceKey, payload().session_id);
    expect(stored?.text).toBe(parsed.hookSpecificOutput.additionalContext);
    expect(stored?.tokenCount).toBe(parsed.hookSpecificOutput.additionalContext.length);
    expect(readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toEqual([
      {
        id: EVENT_ID,
        workspaceKey,
        sessionId: payload().session_id,
        createdAt: new Date(NOW).toISOString(),
        tokenCount: stored?.tokenCount,
      },
    ]);
  });

  it("emits and records at most once when first prompts race", async () => {
    const concurrentInput = {
      ...input(),
      payload: { ...payload(), session_id: "concurrent-first" },
      count: async (text: string) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return text.length;
      },
    };

    const outputs = await Promise.all([
      buildTaskKickoffHookOutput(concurrentInput),
      buildTaskKickoffHookOutput(concurrentInput),
    ]);

    expect(outputs.filter((output) => output !== "")).toHaveLength(1);
    const workspaceKey = encodeWorkspaceKey(projectRoot);
    expect(readTaskKickoffPack(storeRoot, workspaceKey, "concurrent-first")).toBeDefined();
    expect(readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toHaveLength(1);
  });

  it("removes the cache guard when stats append fails so a retry can emit", async () => {
    const workspaceKey = encodeWorkspaceKey(projectRoot);
    const sessionId = "stats-retry";
    const eventPath = taskKickoffEventPath(storeRoot, workspaceKey);
    mkdirSync(eventPath, { recursive: true });

    const failed = await buildTaskKickoffHookOutput({
      ...input(),
      payload: { ...payload(), session_id: sessionId },
    });

    expect(failed).toBe("");
    expect(readTaskKickoffPack(storeRoot, workspaceKey, sessionId)).toBeUndefined();
    rmSync(eventPath, { recursive: true, force: true });

    const retry = await buildTaskKickoffHookOutput({
      ...input(),
      payload: { ...payload(), session_id: sessionId },
    });
    expect(retry).not.toBe("");
    expect(readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toHaveLength(1);
  });

  it("returns before the deadline when git history is slow", async () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-bin-"));
    const fakeGit = join(fakeBin, "git");
    writeFileSync(
      fakeGit,
      `#!${process.execPath}\nsetTimeout(() => process.stdout.write(""), 5_000);\n`,
    );
    chmodSync(fakeGit, 0o700);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const originalPath = process.env["PATH"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["PATH"] = `${fakeBin}:${originalPath ?? ""}`;
    try {
      const startedAt = performance.now();
      const output = await buildTaskKickoffHookOutput({
        ...input(),
        payload: { ...payload(), session_id: "slow-git" },
        deadlineMs: 25,
      });
      const elapsedMs = performance.now() - startedAt;

      expect(output).toBe("");
      expect(elapsedMs).toBeLessThan(500);
    } finally {
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      process.env["PATH"] = originalPath;
      rmSync(fakeBin, { recursive: true, force: true });
    }
  }, 10_000);

  it("redacts the prompt before rendering or hashing it", async () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const sessionId = "redacted-prompt";
    const output = await buildTaskKickoffHookOutput({
      ...input(),
      payload: { ...payload(), prompt: `repair auth with ${secret}`, session_id: sessionId },
    });

    expect(output).not.toContain(secret);
    expect(output).toContain("repair auth with AKIA[REDACTED]");
    const stored = readTaskKickoffPack(storeRoot, encodeWorkspaceKey(projectRoot), sessionId);
    expect(stored?.taskHash).toBe(
      createHash("sha256").update("repair auth with AKIA[REDACTED]").digest("hex"),
    );
  });

  it("returns empty output for unsafe session, absent project/index, renderer error, or deadline", async () => {
    await expect(
      buildTaskKickoffHookOutput({
        ...input(),
        payload: { ...payload(), session_id: "../../x" },
      }),
    ).resolves.toBe("");
    await expect(
      buildTaskKickoffHookOutput({
        ...input(),
        payload: { ...payload(), cwd: join(projectRoot, "..", "absent") },
      }),
    ).resolves.toBe("");

    const absentIndexRoot = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-no-index-"));
    try {
      const { registry } = await ensureStoreReady(storeRoot);
      registry.createProject({
        id: "33333333-3333-4333-8333-333333333333",
        name: "no-index",
        rootPath: absentIndexRoot,
        createdAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
      } as never);
      await expect(
        buildTaskKickoffHookOutput({
          ...input(),
          payload: { ...payload(), cwd: absentIndexRoot, session_id: "no-index" },
        }),
      ).resolves.toBe("");
    } finally {
      rmSync(absentIndexRoot, { recursive: true, force: true });
    }

    await expect(
      buildTaskKickoffHookOutput({
        ...input(),
        payload: { ...payload(), session_id: "renderer-error" },
        count: async () => {
          throw new Error("encoder");
        },
      }),
    ).resolves.toBe("");
    await expect(
      buildTaskKickoffHookOutput({
        ...input(),
        payload: { ...payload(), session_id: "deadline" },
        deadlineMs: 0,
      }),
    ).resolves.toBe("");
  });

  it("settles a late renderer rejection without persisting a pack or event", async () => {
    const unhandled: unknown[] = [];
    const sessionId = "late-rejection";
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(
        buildTaskKickoffHookOutput({
          ...input(),
          payload: { ...payload(), session_id: sessionId },
          deadlineMs: 1,
          count: () =>
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("late render failure")), 20),
            ),
        }),
      ).resolves.toBe("");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
      const workspaceKey = encodeWorkspaceKey(projectRoot);
      expect(readTaskKickoffPack(storeRoot, workspaceKey, sessionId)).toBeUndefined();
      expect(readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
