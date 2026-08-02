import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type CacheAdviceCall = { tool: "Read" | "Grep" | "Glob"; directoryKey: string; at: number };
type TransactionResult = "advise" | "recorded" | "suppressed";
type StoreApi = {
  transactCacheAdvice(input: {
    storeRoot: string;
    workspaceKey: string;
    sessionId: string;
    call: CacheAdviceCall;
    platform?: NodeJS.Platform;
  }): Promise<TransactionResult>;
};

const WORKSPACE_KEY = "0123456789abcdef";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const DIRECTORY_KEY = "a".repeat(64);
const OTHER_DIRECTORY_KEY = "b".repeat(64);
const tmpdir = () => realpathSync("/tmp");
const cliRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(cliRoot, "../..");
const viteNode = join(repoRoot, "node_modules", ".pnpm", "node_modules", ".bin", "vite-node");
const storeModuleUrl = pathToFileURL(
  resolve(import.meta.dirname, "../../src/hooks/cache-advice-store.ts"),
).href;

async function loadStore(): Promise<StoreApi> {
  return import("../../src/hooks/cache-advice-store.js") as Promise<StoreApi>;
}

function stateDirectory(storeRoot: string): string {
  return join(storeRoot, "stats", WORKSPACE_KEY, "cache-advice");
}

function statePath(storeRoot: string, sessionId = SESSION_ID): string {
  return join(stateDirectory(storeRoot), `${sessionId}.json`);
}

function lockPath(storeRoot: string, sessionId = SESSION_ID): string {
  return join(stateDirectory(storeRoot), `${sessionId}.lock`);
}

function validState(directoryKey = DIRECTORY_KEY): string {
  return `${JSON.stringify({
    version: 2,
    offeredDirectoryKeys: [],
    recent: [{ tool: "Read", directoryKey, at: 1_000 }],
  })}\n`;
}

function call(directoryKey = DIRECTORY_KEY, at = 2_000): CacheAdviceCall {
  return { tool: "Grep", directoryKey, at };
}

describe.skipIf(process.platform === "win32")("transactCacheAdvice secure POSIX store", () => {
  let fixtureRoot: string;
  let storeRoot: string;
  let processScript: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "msca-"));
    storeRoot = join(fixtureRoot, "store");
    processScript = join(fixtureRoot, "cache-advice-process.ts");
    writeFileSync(
      processScript,
      [
        `import { transactCacheAdvice } from ${JSON.stringify(storeModuleUrl)};`,
        "const [storeRoot, workspaceKey, sessionId, directoryKey, at] = process.argv.slice(-5);",
        "const result = await transactCacheAdvice({",
        "  storeRoot, workspaceKey, sessionId,",
        '  call: { tool: "Grep", directoryKey, at: Number(at) },',
        "});",
        "process.stdout.write(result);",
      ].join("\n"),
    );
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  async function transact(
    input: Partial<{
      storeRoot: string;
      workspaceKey: string;
      sessionId: string;
      call: CacheAdviceCall;
      platform: NodeJS.Platform;
    }> = {},
  ): Promise<TransactionResult> {
    const { transactCacheAdvice } = await loadStore();
    return transactCacheAdvice({
      storeRoot: input.storeRoot ?? storeRoot,
      workspaceKey: input.workspaceKey ?? WORKSPACE_KEY,
      sessionId: input.sessionId ?? SESSION_ID,
      call: input.call ?? call(),
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
    });
  }

  function runTransactionProcess(at: number): Promise<TransactionResult> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(
        viteNode,
        [
          "--root",
          cliRoot,
          processScript,
          storeRoot,
          WORKSPACE_KEY,
          SESSION_ID,
          DIRECTORY_KEY,
          String(at),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(stderr).toString()));
          return;
        }
        const result = Buffer.concat(stdout).toString();
        if (result === "advise" || result === "recorded" || result === "suppressed") {
          resolveResult(result);
          return;
        }
        reject(new Error(`unexpected transaction result: ${result}`));
      });
    });
  }

  it("serializes eight real subprocesses so a seeded second call advises exactly once", async () => {
    expect(await transact({ call: { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 } })).toBe(
      "recorded",
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => runTransactionProcess(2_000 + index)),
    );

    expect(results.filter((result) => result === "advise")).toHaveLength(1);
    const state = JSON.parse(readFileSync(statePath(storeRoot), "utf8")) as {
      version: number;
      offeredDirectoryKeys: string[];
    };
    expect(state.version).toBe(2);
    expect(state.offeredDirectoryKeys).toEqual([DIRECTORY_KEY]);
    expect(existsSync(lockPath(storeRoot))).toBe(false);
    expect(
      statSync(statePath(storeRoot)).size,
      "serialized state must stay beneath the hard write ceiling",
    ).toBeLessThanOrEqual(32_768);
  }, 20_000);

  it("returns promptly on contention and never waits for or steals an existing lock", async () => {
    expect(await transact({ call: { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 } })).toBe(
      "recorded",
    );
    writeFileSync(lockPath(storeRoot), "crashed\n", { mode: 0o600, flag: "wx" });
    const before = readFileSync(statePath(storeRoot), "utf8");
    const startedAt = performance.now();

    await expect(transact()).resolves.toBe("suppressed");

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(readFileSync(statePath(storeRoot), "utf8")).toBe(before);
    expect(readFileSync(lockPath(storeRoot), "utf8")).toBe("crashed\n");
  });

  it("leaves a terminated lock holder as safe suppression instead of using a PID/mtime lease", async () => {
    expect(await transact({ call: { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 } })).toBe(
      "recorded",
    );
    const holderScript = [
      'import { openSync } from "node:fs";',
      "const descriptor = openSync(process.argv[1], 'wx', 0o600);",
      "process.stdout.write(String(descriptor));",
      "setInterval(() => undefined, 1_000);",
    ].join("\n");
    const holder = spawn(
      process.execPath,
      ["--input-type=module", "--eval", holderScript, lockPath(storeRoot)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolveReady, reject) => {
      holder.stdout.once("data", () => resolveReady());
      holder.once("error", reject);
      holder.once("close", (code) => {
        if (!existsSync(lockPath(storeRoot))) reject(new Error(`holder exited ${code}`));
      });
    });
    holder.kill("SIGKILL");
    await new Promise<void>((resolveClosed) => holder.once("close", () => resolveClosed()));

    const before = readFileSync(statePath(storeRoot), "utf8");
    await expect(transact()).resolves.toBe("suppressed");
    expect(readFileSync(statePath(storeRoot), "utf8")).toBe(before);
    expect(existsSync(lockPath(storeRoot))).toBe(true);
  });

  it("rejects a symlinked cache-advice directory without touching its target", async () => {
    const external = join(fixtureRoot, "external");
    const workspace = join(storeRoot, "stats", WORKSPACE_KEY);
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    chmodSync(storeRoot, 0o700);
    chmodSync(join(storeRoot, "stats"), 0o700);
    chmodSync(workspace, 0o700);
    mkdirSync(external, { mode: 0o700 });
    const sentinel = join(external, "sentinel");
    writeFileSync(sentinel, "unchanged");
    symlinkSync(external, join(workspace, "cache-advice"), "dir");

    await expect(transact()).resolves.toBe("suppressed");

    expect(readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(existsSync(join(external, `${SESSION_ID}.json`))).toBe(false);
    expect(existsSync(join(external, `${SESSION_ID}.lock`))).toBe(false);
  });

  it("rejects a symlinked state path without reading or replacing the target", async () => {
    expect(await transact({ call: { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 } })).toBe(
      "recorded",
    );
    rmSync(statePath(storeRoot));
    const external = join(fixtureRoot, "external-state.json");
    writeFileSync(external, validState(), { mode: 0o600 });
    symlinkSync(external, statePath(storeRoot));

    await expect(transact()).resolves.toBe("suppressed");

    expect(readFileSync(external, "utf8")).toBe(validState());
    expect(statSync(external).nlink).toBe(1);
  });

  it("rejects directory, FIFO, socket, and hard-linked state nodes without replacement", async () => {
    expect(await transact({ call: { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 } })).toBe(
      "recorded",
    );
    const { execFileSync } = await import("node:child_process");

    const directorySession = "state-directory";
    mkdirSync(statePath(storeRoot, directorySession));
    await expect(transact({ sessionId: directorySession })).resolves.toBe("suppressed");
    expect(statSync(statePath(storeRoot, directorySession)).isDirectory()).toBe(true);

    const fifoSession = "state-fifo";
    execFileSync("mkfifo", [statePath(storeRoot, fifoSession)]);
    const fifoStartedAt = performance.now();
    await expect(transact({ sessionId: fifoSession })).resolves.toBe("suppressed");
    expect(performance.now() - fifoStartedAt).toBeLessThan(1_000);
    expect(statSync(statePath(storeRoot, fifoSession)).isFIFO()).toBe(true);

    const socketSession = "state-socket";
    const server = createServer();
    await new Promise<void>((resolveListening, reject) => {
      server.once("error", reject);
      server.listen(statePath(storeRoot, socketSession), resolveListening);
    });
    try {
      expect(lstatSync(statePath(storeRoot, socketSession)).isSocket()).toBe(true);
      await expect(transact({ sessionId: socketSession })).resolves.toBe("suppressed");
      expect(statSync(statePath(storeRoot, socketSession)).isSocket()).toBe(true);
    } finally {
      await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }

    const hardLinkSession = "state-hard-link";
    const external = join(fixtureRoot, "hard-link-source.json");
    writeFileSync(external, validState(), { mode: 0o600 });
    linkSync(external, statePath(storeRoot, hardLinkSession));
    const before = readFileSync(external, "utf8");
    await expect(transact({ sessionId: hardLinkSession })).resolves.toBe("suppressed");
    expect(readFileSync(external, "utf8")).toBe(before);
    expect(statSync(external).nlink).toBe(2);
  });

  it("rejects a device state node when the host permits an isolated fixture device", async ({
    skip,
  }) => {
    expect(await transact({ call: { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 } })).toBe(
      "recorded",
    );
    const deviceSession = "state-device";
    const devicePath = statePath(storeRoot, deviceSession);
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync("mknod", [devicePath, "c", "1", "3"], { stdio: "ignore" });
    } catch {
      skip();
      return;
    }

    await expect(transact({ sessionId: deviceSession })).resolves.toBe("suppressed");
    expect(statSync(devicePath).isCharacterDevice()).toBe(true);
  });

  it("accepts an exact 32,768-byte v2 state and suppresses 32,769 bytes unchanged", async () => {
    expect(await transact({ call: { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 } })).toBe(
      "recorded",
    );
    const base = validState();
    const exact = `${base}${" ".repeat(32_768 - Buffer.byteLength(base))}`;
    expect(Buffer.byteLength(exact)).toBe(32_768);
    writeFileSync(statePath(storeRoot), exact, { mode: 0o600 });
    await expect(transact()).resolves.toBe("advise");

    const oversizedSession = "oversized-state";
    const oversizedPath = statePath(storeRoot, oversizedSession);
    const oversized = `${base}${" ".repeat(32_769 - Buffer.byteLength(base))}`;
    writeFileSync(oversizedPath, oversized, { mode: 0o600 });
    await expect(transact({ sessionId: oversizedSession })).resolves.toBe("suppressed");
    expect(readFileSync(oversizedPath, "utf8")).toBe(oversized);
  });

  it("terminally suppresses malformed and legacy version-1 state without resetting either", async () => {
    expect(await transact({ call: { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 } })).toBe(
      "recorded",
    );
    const legacySession = "legacy-state";
    const malformedSession = "malformed-state";
    const legacy = JSON.stringify({
      offeredDirectories: [],
      recent: [{ tool: "Read", directory: "/private/path", at: 1_000 }],
    });
    const malformed = '{"version":2,"recent":';
    writeFileSync(statePath(storeRoot, legacySession), legacy, { mode: 0o600 });
    writeFileSync(statePath(storeRoot, malformedSession), malformed, { mode: 0o600 });

    await expect(transact({ sessionId: legacySession })).resolves.toBe("suppressed");
    await expect(transact({ sessionId: malformedSession })).resolves.toBe("suppressed");
    expect(readFileSync(statePath(storeRoot, legacySession), "utf8")).toBe(legacy);
    expect(readFileSync(statePath(storeRoot, malformedSession), "utf8")).toBe(malformed);
  });

  it("rejects unsafe segments and Windows before creating any filesystem state", async () => {
    await expect(transact({ workspaceKey: "../escape" })).resolves.toBe("suppressed");
    await expect(transact({ sessionId: "../escape" })).resolves.toBe("suppressed");
    await expect(transact({ platform: "win32" })).resolves.toBe("suppressed");
    expect(existsSync(storeRoot)).toBe(false);
  });

  it("removes only its own successful lock and leaves no temporary residue", async () => {
    await expect(
      transact({ call: { tool: "Read", directoryKey: OTHER_DIRECTORY_KEY, at: 1_000 } }),
    ).resolves.toBe("recorded");
    expect(existsSync(lockPath(storeRoot))).toBe(false);
    expect(readFileSync(statePath(storeRoot), "utf8").includes(OTHER_DIRECTORY_KEY)).toBe(true);
    expect(readdirSync(stateDirectory(storeRoot))).toEqual([`${SESSION_ID}.json`]);
  });
});
