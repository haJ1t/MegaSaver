import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cacheAdviceRecordDirectory,
  cacheAdviceRecordId,
} from "../../src/hooks/cache-advice-queue.js";
import {
  MAX_CACHE_ADVICE_HOOK_STDIN_BYTES,
  buildCacheAdviceHookOutput,
} from "../../src/hooks/cache-advice-run.js";
import { cacheAdviceSessionStorageKey } from "../../src/hooks/cache-advice-store.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const tmpdir = () => realpathSync(readTemporaryDirectory());
const cliRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(cliRoot, "../..");
const viteNode = join(repoRoot, "node_modules", ".pnpm", "node_modules", ".bin", "vite-node");
const runModuleUrl = pathToFileURL(
  resolve(import.meta.dirname, "../../src/hooks/cache-advice-run.ts"),
).href;

function readPayload(cwd: string, filePath: string, sessionId = SESSION_ID): unknown {
  return {
    session_id: sessionId,
    cwd,
    tool_name: "Read",
    tool_input: { file_path: filePath },
  };
}

function searchPayload(
  tool: "Grep" | "Glob",
  cwd: string,
  path: string,
  sessionId = SESSION_ID,
): unknown {
  return {
    session_id: sessionId,
    cwd,
    tool_name: tool,
    tool_input: { path },
  };
}

function statePath(storeRoot: string, cwd: string, sessionId = SESSION_ID): string {
  return join(
    cacheAdviceRecordDirectory(
      storeRoot,
      cacheAdviceRecordId({
        workspaceKey: encodeWorkspaceKey(cwd),
        sessionStorageKey: cacheAdviceSessionStorageKey(sessionId),
      }),
    ),
    "state.json",
  );
}

function pathWithExactBytes(target: string, bytes: number): string {
  const prefix = ".";
  const slashCount = bytes - Buffer.byteLength(prefix) - Buffer.byteLength(target);
  if (slashCount < 1) throw new Error("target is too long for boundary fixture");
  const value = `${prefix}${"/".repeat(slashCount)}${target}`;
  expect(Buffer.byteLength(value)).toBe(bytes);
  return value;
}

function cwdWithExactBytes(cwd: string, bytes: number): string {
  const slashCount = bytes - Buffer.byteLength(cwd);
  if (slashCount < 1) throw new Error("cwd is too long for boundary fixture");
  const value = `${cwd}${"/".repeat(slashCount)}`;
  expect(Buffer.byteLength(value)).toBe(bytes);
  return value;
}

function rawPayloadWithExactBytes(payload: Record<string, unknown>, bytes: number): string {
  const empty = JSON.stringify({ ...payload, padding: "" });
  const paddingBytes = bytes - Buffer.byteLength(empty);
  if (paddingBytes < 0) throw new Error("payload exceeds requested boundary");
  const raw = JSON.stringify({ ...payload, padding: "x".repeat(paddingBytes) });
  expect(Buffer.byteLength(raw)).toBe(bytes);
  return raw;
}

describe("buildCacheAdviceHookOutput", () => {
  let testRoot: string;
  let storeRoot: string;
  let projectRoot: string;
  let sourceDirectory: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "megasaver-cache-advice-"));
    storeRoot = join(testRoot, "store");
    projectRoot = join(testRoot, "project");
    sourceDirectory = join(projectRoot, "src");
    mkdirSync(sourceDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(join(sourceDirectory, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(sourceDirectory, "b.ts"), "export const b = 2;\n");
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("keeps an exact canonical filesystem path separate from its NFC identity", async () => {
    const module = (await import("../../src/hooks/cache-advice-run.js")) as unknown as {
      cacheAdviceCanonicalPath?: (path: string) => {
        filesystemPath: string;
        directoryKeyPath: string;
      };
    };
    const nfdPath = "/tmp/cafe\u0301";

    expect(module.cacheAdviceCanonicalPath?.(nfdPath)).toEqual({
      filesystemPath: nfdPath,
      directoryKeyPath: "/tmp/caf\u00e9",
    });
  });

  it.skipIf(process.platform === "win32")(
    "canonicalizes directory aliases and emits only additionalContext on the second call",
    async () => {
      const alias = join(projectRoot, "source-alias");
      symlinkSync(sourceDirectory, alias, "dir");

      const first = await buildCacheAdviceHookOutput({
        payload: readPayload(projectRoot, "src/a.ts"),
        storeRoot,
        now: () => 1_000,
      });
      const second = await buildCacheAdviceHookOutput({
        payload: searchPayload("Grep", projectRoot, "source-alias"),
        storeRoot,
        now: () => 2_000,
      });

      expect(first).toBe("");
      const result = JSON.parse(second) as {
        hookSpecificOutput: Record<string, unknown>;
      };
      expect(result.hookSpecificOutput).toEqual({
        hookEventName: "PreToolUse",
        additionalContext: expect.stringContaining("Batch remaining exploration"),
      });
      expect(result.hookSpecificOutput).not.toHaveProperty("permissionDecision");

      const rawState = readFileSync(statePath(storeRoot, projectRoot), "utf8");
      const state = JSON.parse(rawState) as Record<string, unknown>;
      expect(state).toMatchObject({ version: 2 });
      expect(state).toHaveProperty("offeredDirectoryKeys");
      expect(rawState).not.toContain(projectRoot);
      expect(Buffer.byteLength(rawState)).toBeLessThanOrEqual(32_768);
    },
  );

  it.skipIf(process.platform === "win32")(
    "uses one workspace lock and state when cwd aliases name the same canonical project",
    async () => {
      const cwdAlias = join(testRoot, "project-alias");
      symlinkSync(projectRoot, cwdAlias, "dir");

      expect(
        await buildCacheAdviceHookOutput({
          payload: readPayload(projectRoot, "src/a.ts"),
          storeRoot,
          now: () => 1_000,
        }),
      ).toBe("");
      expect(
        await buildCacheAdviceHookOutput({
          payload: readPayload(cwdAlias, "src/b.ts"),
          storeRoot,
          now: () => 2_000,
        }),
      ).toContain("additionalContext");

      expect(existsSync(statePath(storeRoot, projectRoot))).toBe(true);
      expect(existsSync(statePath(storeRoot, cwdAlias))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "scopes the same session and canonical target independently to distinct workspaces",
    async () => {
      const secondWorkspace = join(testRoot, "second-project");
      const sharedDirectory = join(testRoot, "shared");
      const sharedTarget = join(sharedDirectory, "target.ts");
      mkdirSync(secondWorkspace, { mode: 0o700 });
      mkdirSync(sharedDirectory, { mode: 0o700 });
      writeFileSync(sharedTarget, "export const shared = true;\n");
      const sessionId = "workspace-scoped-session";

      for (const cwd of [projectRoot, secondWorkspace]) {
        expect(
          await buildCacheAdviceHookOutput({
            payload: readPayload(cwd, sharedTarget, sessionId),
            storeRoot,
            now: () => 1_000,
          }),
        ).toBe("");
      }
      for (const cwd of [projectRoot, secondWorkspace]) {
        expect(
          await buildCacheAdviceHookOutput({
            payload: readPayload(cwd, sharedTarget, sessionId),
            storeRoot,
            now: () => 2_000,
          }),
        ).toContain("additionalContext");
        expect(existsSync(statePath(storeRoot, cwd, sessionId))).toBe(true);
      }
    },
  );

  it.runIf(process.platform === "linux")(
    "uses an NFD-only cwd for filesystem access while hashing its NFC identity",
    async () => {
      const nfdCwd = join(testRoot, "cafe\u0301");
      const nfdSource = join(nfdCwd, "src");
      const sessionId = "nfd-filesystem-path";
      mkdirSync(nfdSource, { recursive: true, mode: 0o700 });
      writeFileSync(join(nfdSource, "only-nfd.ts"), "export {};\n");

      await expect(
        buildCacheAdviceHookOutput({
          payload: readPayload(nfdCwd, "src/only-nfd.ts", sessionId),
          storeRoot,
          now: () => 1_000,
        }),
      ).resolves.toBe("");

      expect(existsSync(statePath(storeRoot, nfdCwd, sessionId))).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "maps Grep and Glob regular-file targets to the same canonical parent as Read",
    async () => {
      const grepSession = "22222222-2222-4222-8222-222222222222";
      const globSession = "33333333-3333-4333-8333-333333333333";

      expect(
        await buildCacheAdviceHookOutput({
          payload: readPayload(projectRoot, "src/a.ts", grepSession),
          storeRoot,
          now: () => 1_000,
        }),
      ).toBe("");
      expect(
        await buildCacheAdviceHookOutput({
          payload: searchPayload("Grep", projectRoot, "src/b.ts", grepSession),
          storeRoot,
          now: () => 2_000,
        }),
      ).toContain("additionalContext");

      expect(
        await buildCacheAdviceHookOutput({
          payload: searchPayload("Glob", projectRoot, "src/a.ts", globSession),
          storeRoot,
          now: () => 1_000,
        }),
      ).toBe("");
      expect(
        await buildCacheAdviceHookOutput({
          payload: readPayload(projectRoot, "src/b.ts", globSession),
          storeRoot,
          now: () => 2_000,
        }),
      ).toContain("additionalContext");
    },
  );

  it.skipIf(process.platform === "win32")(
    "accepts exact 4096-byte cwd and tool paths but rejects 4097 bytes",
    async () => {
      const exactCwd = cwdWithExactBytes(projectRoot, 4_096);
      const exactPath = pathWithExactBytes("src/a.ts", 4_096);
      const acceptedSession = "44444444-4444-4444-8444-444444444444";
      const rejectedSession = "55555555-5555-4555-8555-555555555555";

      await expect(
        buildCacheAdviceHookOutput({
          payload: readPayload(exactCwd, exactPath, acceptedSession),
          storeRoot,
          now: () => 1_000,
        }),
      ).resolves.toBe("");
      expect(existsSync(statePath(storeRoot, projectRoot, acceptedSession))).toBe(true);

      await expect(
        buildCacheAdviceHookOutput({
          payload: readPayload(projectRoot, pathWithExactBytes("src/a.ts", 4_097), rejectedSession),
          storeRoot,
          now: () => 1_000,
        }),
      ).resolves.toBe("");
      expect(existsSync(statePath(storeRoot, projectRoot, rejectedSession))).toBe(false);

      const oversizedCwd = cwdWithExactBytes(projectRoot, 4_097);
      await buildCacheAdviceHookOutput({
        payload: readPayload(oversizedCwd, "src/a.ts", rejectedSession),
        storeRoot,
        now: () => 1_000,
      });
      expect(existsSync(statePath(storeRoot, oversizedCwd, rejectedSession))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "creates no state for nonexistent, directory, or special targets",
    async () => {
      const fifo = join(projectRoot, "read-target.fifo");
      const { execFileSync } = await import("node:child_process");
      execFileSync("mkfifo", [fifo]);
      const invalidPayloads = [
        readPayload(projectRoot, "missing.ts"),
        readPayload(projectRoot, "src"),
        readPayload(projectRoot, fifo),
        searchPayload("Grep", projectRoot, "missing"),
        searchPayload("Glob", projectRoot, fifo),
      ];

      for (const [index, payload] of invalidPayloads.entries()) {
        const sessionId = `invalid-target-${index}`;
        const withSession = { ...(payload as Record<string, unknown>), session_id: sessionId };
        await expect(
          buildCacheAdviceHookOutput({ payload: withSession, storeRoot, now: () => 1_000 }),
        ).resolves.toBe("");
        expect(existsSync(statePath(storeRoot, projectRoot, sessionId))).toBe(false);
      }
    },
  );

  it("returns empty output without state for unknown tools, missing paths, and unsafe ids", async () => {
    const invalidPayloads: unknown[] = [
      {
        session_id: SESSION_ID,
        cwd: projectRoot,
        tool_name: "Bash",
        tool_input: { command: "pwd" },
      },
      {
        session_id: SESSION_ID,
        cwd: projectRoot,
        tool_name: "Read",
        tool_input: {},
      },
      readPayload(projectRoot, "src/a.ts", "../unsafe"),
    ];

    for (const payload of invalidPayloads) {
      await expect(
        buildCacheAdviceHookOutput({ payload, storeRoot, now: () => 1_000 }),
      ).resolves.toBe("");
    }
    expect(existsSync(storeRoot)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "writes version-2 session state with owner-only permissions",
    async () => {
      await buildCacheAdviceHookOutput({
        payload: readPayload(projectRoot, "src/a.ts"),
        storeRoot,
        now: () => 1_000,
      });

      const path = statePath(storeRoot, projectRoot);
      const stateDirectory = dirname(path);
      const state = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

      expect(state).toMatchObject({
        version: 2,
        offeredDirectoryKeys: [],
        recent: [{ tool: "Read", at: 1_000 }],
      });
      expect(JSON.stringify(state)).not.toContain(projectRoot);
      expect(statSync(stateDirectory).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    },
  );

  it("returns empty output for Windows without creating advice state", async () => {
    await expect(
      buildCacheAdviceHookOutput({
        payload: readPayload(projectRoot, "src/a.ts"),
        storeRoot,
        now: () => 1_000,
        platform: "win32",
      } as never),
    ).resolves.toBe("");
    expect(existsSync(storeRoot)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "returns empty output for state I/O and internal errors",
    async () => {
      const blockedStoreRoot = join(testRoot, "not-a-directory");
      writeFileSync(blockedStoreRoot, "blocked");

      await expect(
        buildCacheAdviceHookOutput({
          payload: readPayload(projectRoot, "src/a.ts"),
          storeRoot: blockedStoreRoot,
          now: () => 1_000,
        }),
      ).resolves.toBe("");
      await expect(
        buildCacheAdviceHookOutput({
          payload: readPayload(projectRoot, "src/a.ts"),
          storeRoot,
          now: () => {
            throw new Error("clock failed");
          },
        }),
      ).resolves.toBe("");
    },
  );

  it.skipIf(process.platform === "win32")(
    "emits nothing while legacy flat state exists and migration is incomplete",
    async () => {
      const workspaceKey = encodeWorkspaceKey(projectRoot);
      const legacyDirectory = join(storeRoot, "stats", workspaceKey, "cache-advice");
      mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
      chmodSync(storeRoot, 0o700);
      chmodSync(join(storeRoot, "stats"), 0o700);
      chmodSync(join(storeRoot, "stats", workspaceKey), 0o700);
      chmodSync(legacyDirectory, 0o700);
      const legacyPath = join(legacyDirectory, `${cacheAdviceSessionStorageKey(SESSION_ID)}.json`);
      writeFileSync(
        legacyPath,
        `${JSON.stringify({
          version: 2,
          offeredDirectoryKeys: [],
          recent: [{ tool: "Read", directoryKey: "a".repeat(64), at: 1_000 }],
        })}\n`,
        { mode: 0o600 },
      );

      // First call: suppressed (migration incomplete), no advice output,
      // legacy node untouched, no v3 capsule created by the hook.
      await expect(
        buildCacheAdviceHookOutput({
          payload: readPayload(projectRoot, "src/a.ts"),
          storeRoot,
          now: () => 1_000,
        }),
      ).resolves.toBe("");
      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(statePath(storeRoot, projectRoot))).toBe(false);

      // Second call (would normally advise): still empty while incomplete.
      await expect(
        buildCacheAdviceHookOutput({
          payload: readPayload(projectRoot, "src/b.ts"),
          storeRoot,
          now: () => 2_000,
        }),
      ).resolves.toBe("");
      expect(existsSync(legacyPath)).toBe(true);

      // After the off-hook maintainer completes, the legacy node is gone and
      // the hook records v3 state again (no longer fenced).
      const maintenance = (await import("../../src/hooks/cache-advice-maintenance.js")) as {
        maintainCacheAdviceStore(input: {
          storeRoot: string;
          now: number;
        }): Promise<"complete" | "incomplete" | "suppressed">;
      };
      await expect(maintenance.maintainCacheAdviceStore({ storeRoot, now: 2_000 })).resolves.toBe(
        "complete",
      );
      expect(existsSync(legacyPath)).toBe(false);
      // GC-marker cadence after a first maintenance pass suppresses the next
      // immediate call; advice resumption itself is covered by the queue
      // suite, which drives the transaction clock past the GC interval.
    },
  );
});

describe.skipIf(process.platform === "win32")("cache advice stdin byte ceiling", () => {
  let testRoot: string;
  let projectRoot: string;
  let commandScript: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "megasaver-cache-advice-stdin-"));
    projectRoot = join(testRoot, "project");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "a.ts"), "export {};\n");
    commandScript = join(testRoot, "run-cache-advice.ts");
    writeFileSync(
      commandScript,
      [
        `import { runCacheAdviceHookFromProcess } from ${JSON.stringify(runModuleUrl)};`,
        "await runCacheAdviceHookFromProcess(process.argv[2]);",
      ].join("\n"),
    );
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  function runRaw(raw: string, storeRoot: string): Promise<{ code: number; stdout: string }> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(viteNode, ["--root", cliRoot, commandScript, storeRoot], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) {
          resolveResult({ code, stdout: Buffer.concat(stdout).toString() });
          return;
        }
        reject(new Error(Buffer.concat(stderr).toString()));
      });
      child.stdin.end(raw);
    });
  }

  it("accepts exactly 65,536 bytes and rejects 65,537 before JSON parsing or state I/O", async () => {
    expect(MAX_CACHE_ADVICE_HOOK_STDIN_BYTES).toBe(65_536);
    const base = {
      session_id: SESSION_ID,
      cwd: projectRoot,
      tool_name: "Read",
      tool_input: { file_path: "a.ts" },
    };
    const acceptedStore = join(testRoot, "accepted-store");
    const rejectedStore = join(testRoot, "rejected-store");

    const accepted = await runRaw(
      rawPayloadWithExactBytes(base, MAX_CACHE_ADVICE_HOOK_STDIN_BYTES),
      acceptedStore,
    );
    expect(accepted).toEqual({ code: 0, stdout: "" });
    expect(existsSync(statePath(acceptedStore, projectRoot))).toBe(true);

    const rejected = await runRaw(
      rawPayloadWithExactBytes(base, MAX_CACHE_ADVICE_HOOK_STDIN_BYTES + 1),
      rejectedStore,
    );
    expect(rejected).toEqual({ code: 0, stdout: "" });
    expect(existsSync(rejectedStore)).toBe(false);
  });

  it("leaves no filesystem state when injected Windows runtime handles valid input", async () => {
    const storeRoot = join(testRoot, "windows-store");
    const output = await buildCacheAdviceHookOutput({
      payload: readPayload(projectRoot, "a.ts"),
      storeRoot,
      now: () => 1_000,
      platform: "win32",
    } as never);
    expect(output).toBe("");
    expect(existsSync(storeRoot)).toBe(false);
    expect(() => lstatSync(storeRoot)).toThrow();
  });
});
