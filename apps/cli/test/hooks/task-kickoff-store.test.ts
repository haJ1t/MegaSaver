import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readTaskKickoffPack,
  taskKickoffPackPath,
  writeTaskKickoffPack,
} from "../../src/hooks/task-kickoff-store.js";

const roots: string[] = [];
const workspace = "workspace-key";
const safeSession = "session-123";
const stored = {
  taskHash: "a".repeat(64),
  text: "# Task kickoff",
  tokenCount: 42,
  createdAt: 1_754_006_400_000,
};

function createRoot(): string {
  const root = mkdtempSync(`${tmpdir()}/megasaver-task-pack-`);
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("task kickoff store", () => {
  it("writes and reads one safe session cache under stats/<workspace>/task-pack", () => {
    const root = createRoot();
    writeTaskKickoffPack(root, workspace, safeSession, stored);

    expect(readTaskKickoffPack(root, workspace, safeSession)).toEqual(stored);
  });

  it("treats malformed and unsafe-session state as absent while preserving one session emission guard", () => {
    const root = createRoot();
    expect(readTaskKickoffPack(root, workspace, "../../escape")).toBeUndefined();
    writeTaskKickoffPack(root, workspace, safeSession, stored);
    writeFileSync(taskKickoffPackPath(root, workspace, safeSession), "{ bad json");
    expect(readTaskKickoffPack(root, workspace, safeSession)).toBeUndefined();
    writeTaskKickoffPack(root, workspace, safeSession, {
      ...stored,
      createdAt: 1,
    });
    expect(readTaskKickoffPack(root, workspace, safeSession)).toEqual({ ...stored, createdAt: 1 });
  });

  it.skipIf(process.platform === "win32")("uses owner-only directory and file permissions", () => {
    const root = createRoot();
    writeTaskKickoffPack(root, workspace, safeSession, stored);

    expect(statSync(dirname(taskKickoffPackPath(root, workspace, safeSession))).mode & 0o777).toBe(
      0o700,
    );
    expect(statSync(taskKickoffPackPath(root, workspace, safeSession)).mode & 0o777).toBe(0o600);
  });
});
