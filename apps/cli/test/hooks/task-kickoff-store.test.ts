import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { open, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTaskKickoffSessionClaim,
  hasTaskKickoffSessionClaim,
  prepareTaskKickoffStorage,
  readTaskKickoffPack,
  taskKickoffPackPath,
  taskKickoffSessionClaimPath,
  writeTaskKickoffPack,
} from "../../src/hooks/task-kickoff-store.js";

const roots: string[] = [];
const workspace = "1a2b3c4d5e6f7a8b";
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
  it("refuses traversal-shaped workspace keys before pack path access", async () => {
    const parent = createRoot();
    const root = join(parent, "store");
    mkdirSync(root);
    const escapedPack = join(parent, "escape", "task-pack", `${safeSession}.json`);

    expect(() => taskKickoffPackPath(root, "../../escape", safeSession)).toThrow();
    expect(readTaskKickoffPack(root, "../../escape", safeSession)).toBeUndefined();
    await expect(writeTaskKickoffPack(root, "../../escape", safeSession, stored)).rejects.toThrow();
    await expect(
      prepareTaskKickoffStorage(root, "../../escape", safeSession, {
        signal: new AbortController().signal,
      }),
    ).resolves.toBeNull();
    expect(existsSync(escapedPack)).toBe(false);
  });

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
          workspaceKey: "aaaaaaaaaaaaaaaa",
          eventId: "11111111-1111-4111-8111-111111111111",
          createdAt: "2026-08-01T10:00:00.000Z",
        },
        {
          workspaceKey: "bbbbbbbbbbbbbbbb",
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
    "prepares the full absolute directory chain before opening a global claim",
    async () => {
      const root = createRoot();
      const statsDirectory = join(root, "stats");
      const claimDirectory = join(statsDirectory, "task-kickoff-sessions");
      const workspaceDirectory = join(statsDirectory, workspace);
      const packDirectory = join(workspaceDirectory, "task-pack");
      const claimPath = taskKickoffSessionClaimPath(root, safeSession);
      const operations: string[] = [];
      const dependencies = {
        open: async (path: string, flags: "r" | "wx", mode?: number) => {
          const handle = await open(path, flags, mode);
          operations.push(`file-open:${path}`);
          return {
            writeFile: async (content: string) => handle.writeFile(content),
            sync: async () => handle.sync(),
            close: async () => handle.close(),
          };
        },
        openDirectory: async (path: string) => {
          operations.push(`directory-open:${path}`);
          const handle = await open(path, "r");
          return {
            chmod: async (mode: number) => handle.chmod(mode),
            sync: async () => {
              operations.push(`directory-sync:${path}`);
              await handle.sync();
            },
            close: async () => {
              await handle.close();
              operations.push(`directory-close:${path}`);
            },
          };
        },
        syncDirectory: async (path: string) => {
          operations.push(`directory-open:${path}`);
          const handle = await open(path, "r");
          try {
            operations.push(`directory-sync:${path}`);
            await handle.sync();
          } finally {
            await handle.close();
            operations.push(`directory-close:${path}`);
          }
        },
      };
      const signal = new AbortController().signal;
      const prepared = await prepareTaskKickoffStorage(root, workspace, safeSession, {
        signal,
        dependencies,
      });
      if (prepared === null) throw new Error("task kickoff storage was not prepared");

      await expect(
        prepared.createSessionClaim(
          {
            workspaceKey: workspace,
            eventId: "11111111-1111-4111-8111-111111111111",
            createdAt: "2026-08-01T10:00:00.000Z",
          },
          signal,
        ),
      ).resolves.toBe(true);

      const claimOpen = operations.indexOf(`file-open:${claimPath}`);
      expect(claimOpen).toBeGreaterThanOrEqual(0);
      expect(operations.slice(0, claimOpen)).toEqual([
        `directory-open:${root}`,
        `directory-sync:${root}`,
        `directory-close:${root}`,
        `directory-open:${statsDirectory}`,
        `directory-sync:${statsDirectory}`,
        `directory-close:${statsDirectory}`,
        `directory-open:${root}`,
        `directory-sync:${root}`,
        `directory-close:${root}`,
        `directory-open:${claimDirectory}`,
        `directory-sync:${claimDirectory}`,
        `directory-close:${claimDirectory}`,
        `directory-open:${statsDirectory}`,
        `directory-sync:${statsDirectory}`,
        `directory-close:${statsDirectory}`,
        `directory-open:${workspaceDirectory}`,
        `directory-sync:${workspaceDirectory}`,
        `directory-close:${workspaceDirectory}`,
        `directory-open:${statsDirectory}`,
        `directory-sync:${statsDirectory}`,
        `directory-close:${statsDirectory}`,
        `directory-open:${packDirectory}`,
        `directory-sync:${packDirectory}`,
        `directory-close:${packDirectory}`,
        `directory-open:${workspaceDirectory}`,
        `directory-sync:${workspaceDirectory}`,
        `directory-close:${workspaceDirectory}`,
      ]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "durably creates every task-kickoff directory component before file publication",
    async () => {
      const root = createRoot();
      const operations: string[] = [];
      const dependencies = {
        open: async (path: string, flags: "r" | "wx", mode?: number) => {
          const handle = await open(path, flags, mode);
          const kind = basename(path).endsWith(".json") ? "claim" : "pack";
          operations.push(`${kind}:open`);
          return {
            writeFile: async (content: string) => {
              operations.push(`${kind}:write`);
              await handle.writeFile(content);
            },
            sync: async () => {
              operations.push(`${kind}:sync`);
              await handle.sync();
            },
            close: async () => {
              await handle.close();
              operations.push(`${kind}:close`);
            },
          };
        },
        rename: async (source: string, destination: string) => {
          operations.push("pack:rename");
          await rename(source, destination);
        },
        openDirectory: async (path: string) => {
          const kind = path === root ? "root" : basename(path);
          operations.push(`${kind}:directory-open`);
          const handle = await open(path, "r");
          return {
            chmod: async (mode: number) => handle.chmod(mode),
            sync: async () => {
              operations.push(`${kind}:directory-sync`);
              await handle.sync();
            },
            close: async () => {
              await handle.close();
              operations.push(`${kind}:directory-close`);
            },
          };
        },
        syncDirectory: async (path: string) => {
          const kind = path === root ? "root" : basename(path);
          operations.push(`${kind}:directory-open`);
          const handle = await open(path, "r");
          try {
            operations.push(`${kind}:directory-sync`);
            await handle.sync();
          } finally {
            await handle.close();
            operations.push(`${kind}:directory-close`);
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
        "root:directory-open",
        "root:directory-sync",
        "root:directory-close",
        "stats:directory-open",
        "stats:directory-sync",
        "stats:directory-close",
        "root:directory-open",
        "root:directory-sync",
        "root:directory-close",
        "task-kickoff-sessions:directory-open",
        "task-kickoff-sessions:directory-sync",
        "task-kickoff-sessions:directory-close",
        "stats:directory-open",
        "stats:directory-sync",
        "stats:directory-close",
        "claim:open",
        "claim:write",
        "claim:sync",
        "claim:close",
        "task-kickoff-sessions:directory-open",
        "task-kickoff-sessions:directory-sync",
        "task-kickoff-sessions:directory-close",
        "root:directory-open",
        "root:directory-sync",
        "root:directory-close",
        "stats:directory-open",
        "stats:directory-sync",
        "stats:directory-close",
        "root:directory-open",
        "root:directory-sync",
        "root:directory-close",
        `${workspace}:directory-open`,
        `${workspace}:directory-sync`,
        `${workspace}:directory-close`,
        "stats:directory-open",
        "stats:directory-sync",
        "stats:directory-close",
        "task-pack:directory-open",
        "task-pack:directory-sync",
        "task-pack:directory-close",
        `${workspace}:directory-open`,
        `${workspace}:directory-sync`,
        `${workspace}:directory-close`,
        "pack:open",
        "pack:write",
        "pack:sync",
        "pack:close",
        "pack:rename",
        "task-pack:directory-open",
        "task-pack:directory-sync",
        "task-pack:directory-close",
      ]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "preserves a pack write failure when temporary cleanup also fails",
    async () => {
      const root = createRoot();
      const writeFailure = Object.assign(new Error("injected pack write failure"), { code: "EIO" });
      const cleanupFailure = Object.assign(new Error("injected cleanup failure"), {
        code: "EPERM",
      });
      const dependencies = {
        open: async (path: string, flags: "r" | "wx", mode?: number) => {
          const handle = await open(path, flags, mode);
          if (!basename(path).endsWith(".tmp")) return handle;
          return {
            writeFile: async () => {
              throw writeFailure;
            },
            sync: async () => handle.sync(),
            close: async () => handle.close(),
          };
        },
        remove: async () => {
          throw cleanupFailure;
        },
      };
      const claim = {
        workspaceKey: workspace,
        eventId: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-08-01T10:00:00.000Z",
      };

      await expect(
        createTaskKickoffSessionClaim(
          root,
          safeSession,
          claim,
          new AbortController().signal,
          dependencies,
        ),
      ).resolves.toBe(true);
      await expect(
        writeTaskKickoffPack(root, workspace, safeSession, stored, dependencies),
      ).rejects.toBe(writeFailure);

      expect(hasTaskKickoffSessionClaim(root, safeSession)).toBe(true);
      expect(readTaskKickoffPack(root, workspace, safeSession)).toBeUndefined();
    },
  );
});
