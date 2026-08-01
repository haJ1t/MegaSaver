import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
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
  it.skipIf(process.platform === "win32")(
    "writes and reads one safe session cache under stats/<workspace>/task-pack",
    async () => {
      const root = createRoot();
      await writeTaskKickoffPack(root, workspace, safeSession, stored);

      expect(readTaskKickoffPack(root, workspace, safeSession)).toEqual(stored);
    },
  );

  it.skipIf(process.platform === "win32")(
    "treats malformed and unsafe-session state as absent while preserving one session emission guard",
    async () => {
      const root = createRoot();
      expect(readTaskKickoffPack(root, workspace, "../../escape")).toBeUndefined();
      await writeTaskKickoffPack(root, workspace, safeSession, stored);
      writeFileSync(taskKickoffPackPath(root, workspace, safeSession), "{ bad json");
      expect(readTaskKickoffPack(root, workspace, safeSession)).toBeUndefined();
      await writeTaskKickoffPack(root, workspace, safeSession, {
        ...stored,
        createdAt: 1,
      });
      expect(readTaskKickoffPack(root, workspace, safeSession)).toEqual({
        ...stored,
        createdAt: 1,
      });
    },
  );

  it("treats a partial global session claim as terminal", () => {
    const root = createRoot();
    const claimPath = taskKickoffSessionClaimPath(root, safeSession);
    mkdirSync(dirname(claimPath), { recursive: true });
    writeFileSync(claimPath, "");

    expect(hasTaskKickoffSessionClaim(root, safeSession)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "atomically selects one global claim winner",
    async () => {
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
    },
  );

  it.skipIf(process.platform === "win32")(
    "uses owner-only claim and pack directory and file permissions",
    async () => {
      const root = createRoot();
      const signal = new AbortController().signal;
      await createTaskKickoffSessionClaim(
        root,
        safeSession,
        {
          workspaceKey: workspace,
          eventId: "11111111-1111-4111-8111-111111111111",
          createdAt: "2026-08-01T10:00:00.000Z",
        },
        signal,
      );
      await writeTaskKickoffPack(root, workspace, safeSession, stored);

      const paths = [
        taskKickoffSessionClaimPath(root, safeSession),
        taskKickoffPackPath(root, workspace, safeSession),
      ];
      for (const path of paths) {
        expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
        expect(statSync(path).mode & 0o777).toBe(0o600);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "syncs each file before publishing it and then syncs its owning directory",
    async () => {
      const root = createRoot();
      const operations: string[] = [];
      const dependencies = {
        open: async (path: string, flags: "r" | "wx", mode?: number) => {
          const handle = await open(path, flags, mode);
          const kind = basename(path).endsWith(".json") ? "claim" : "pack";
          return {
            writeFile: async (content: string) => {
              operations.push(`${kind}:write`);
              await handle.writeFile(content);
            },
            sync: async () => {
              operations.push(`${kind}:sync`);
              await handle.sync();
            },
            close: async () => handle.close(),
          };
        },
        rename: async (source: string, destination: string) => {
          operations.push("pack:rename");
          await rename(source, destination);
        },
        syncDirectory: async (path: string) => {
          operations.push(`${basename(path)}:directory-sync`);
          const handle = await open(path, "r");
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
        },
      };
      const signal = new AbortController().signal;

      await createTaskKickoffSessionClaim(
        root,
        safeSession,
        {
          workspaceKey: workspace,
          eventId: "11111111-1111-4111-8111-111111111111",
          createdAt: "2026-08-01T10:00:00.000Z",
        },
        signal,
        dependencies,
      );
      await writeTaskKickoffPack(root, workspace, safeSession, stored, dependencies);

      expect(operations).toEqual([
        "task-kickoff-sessions:directory-sync",
        "claim:write",
        "claim:sync",
        "task-kickoff-sessions:directory-sync",
        "task-pack:directory-sync",
        "pack:write",
        "pack:sync",
        "pack:rename",
        "task-pack:directory-sync",
      ]);
    },
  );
});
