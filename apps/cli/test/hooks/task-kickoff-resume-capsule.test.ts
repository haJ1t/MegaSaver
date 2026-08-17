import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { dirname, join } from "node:path";
import { buildIndex } from "@megasaver/indexer";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeResumeCapsule,
  resumeCapsulePath,
  writeResumeCapsule,
} from "../../src/hooks/resume-capsule.js";
import { buildTaskKickoffHookOutput } from "../../src/hooks/task-kickoff.js";
import { taskKickoffSessionClaimPath } from "../../src/hooks/task-kickoff-store.js";
import { ensureStoreReady } from "../../src/store.js";

const tmpdir = () => realpathSync(readTemporaryDirectory());
const NOW = Date.parse("2026-08-06T10:00:00.000Z");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

let storeRoot: string;
let projectRoot: string;

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-capsule-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-capsule-project-"));
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

describe("task kickoff resume capsule delivery", () => {
  it.skipIf(process.platform === "win32")(
    "delivers a pending capsule through the kickoff envelope exactly once",
    async () => {
      const wk = encodeWorkspaceKey(projectRoot);
      writeResumeCapsule(storeRoot, wk, {
        version: 1,
        sourceSessionId: "dead-session-1",
        text: "# Session resurrection — demo\npointer body\n",
        tokenCount: 12,
        createdAt: Date.now() - 60_000,
      });
      const out = await buildTaskKickoffHookOutput({
        payload: { prompt: "continue the auth fix", cwd: projectRoot, session_id: "next-1" },
        storeRoot,
        now: () => Date.now(),
        deadlineAtMs: Date.now() + 5_000,
        count: async (t) => Math.ceil(t.length / 4),
      });
      const envelope = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(envelope.hookSpecificOutput.additionalContext).toContain("# Session resurrection");
      expect(existsSync(taskKickoffSessionClaimPath(storeRoot, "next-1"))).toBe(true);
      expect(existsSync(resumeCapsulePath(storeRoot, wk))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "renders the standard kickoff pack when no capsule is pending",
    async () => {
      const out = await buildTaskKickoffHookOutput({
        payload: { prompt: "repair auth", cwd: projectRoot, session_id: "next-2" },
        storeRoot,
        now: () => Date.now(),
        deadlineAtMs: Date.now() + 5_000,
        count: async (t) => Math.ceil(t.length / 4),
      });
      const envelope = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(envelope.hookSpecificOutput.additionalContext).toContain("# Task kickoff");
    },
  );

  it.skipIf(process.platform === "win32")(
    "leaves the capsule untouched for a session that already holds a claim",
    async () => {
      const wk = encodeWorkspaceKey(projectRoot);
      writeResumeCapsule(storeRoot, wk, {
        version: 1,
        sourceSessionId: "dead-session-1",
        text: "# Session resurrection — demo\npointer body\n",
        tokenCount: 12,
        createdAt: Date.now() - 60_000,
      });
      mkdirSync(dirname(taskKickoffSessionClaimPath(storeRoot, "claimed-1")), {
        recursive: true,
      });
      writeFileSync(taskKickoffSessionClaimPath(storeRoot, "claimed-1"), "{}\n");
      const out = await buildTaskKickoffHookOutput({
        payload: { prompt: "anything", cwd: projectRoot, session_id: "claimed-1" },
        storeRoot,
        now: () => Date.now(),
        deadlineAtMs: Date.now() + 5_000,
        count: async (t) => Math.ceil(t.length / 4),
      });
      expect(out).toBe("");
      expect(existsSync(resumeCapsulePath(storeRoot, wk))).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "discards a stale capsule and falls back to the standard pack",
    async () => {
      const wk = encodeWorkspaceKey(projectRoot);
      writeResumeCapsule(storeRoot, wk, {
        version: 1,
        sourceSessionId: "dead-session-1",
        text: "# Session resurrection — stale\n",
        tokenCount: 8,
        createdAt: Date.now() - 25 * 60 * 60_000,
      });
      const out = await buildTaskKickoffHookOutput({
        payload: { prompt: "repair auth", cwd: projectRoot, session_id: "next-3" },
        storeRoot,
        now: () => Date.now(),
        deadlineAtMs: Date.now() + 5_000,
        count: async (t) => Math.ceil(t.length / 4),
      });
      const envelope = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(envelope.hookSpecificOutput.additionalContext).toContain("# Task kickoff");
      expect(existsSync(resumeCapsulePath(storeRoot, wk))).toBe(false);
      expect(consumeResumeCapsule(storeRoot, wk, "next-4")).toBeNull();
    },
  );
});
