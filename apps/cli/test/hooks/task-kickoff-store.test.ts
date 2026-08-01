import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTaskKickoffSessionClaim,
  hasTaskKickoffSessionClaim,
  readTaskKickoffPack,
  taskKickoffPackPath,
  taskKickoffSessionClaimPath,
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

  it("treats a partial global session claim as terminal", () => {
    const root = createRoot();
    const claimPath = taskKickoffSessionClaimPath(root, safeSession);
    mkdirSync(dirname(claimPath), { recursive: true });
    writeFileSync(claimPath, "");

    expect(hasTaskKickoffSessionClaim(root, safeSession)).toBe(true);
  });

  it("atomically selects one global claim winner", async () => {
    const root = createRoot();
    const controller = new AbortController();
    const claims = [
      {
        workspaceKey: "workspace-a",
        eventId: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-08-01T10:00:00.000Z",
      },
      {
        workspaceKey: "workspace-b",
        eventId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-08-01T10:00:00.000Z",
      },
    ];

    const results = await Promise.all(
      claims.map((claim) =>
        createTaskKickoffSessionClaim(root, safeSession, claim, controller.signal),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const storedClaim = JSON.parse(
      readFileSync(taskKickoffSessionClaimPath(root, safeSession), "utf8"),
    );
    expect(claims).toContainEqual(storedClaim);
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
