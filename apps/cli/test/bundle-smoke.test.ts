import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTaskKickoffEvents } from "@megasaver/core";
import { buildIndex } from "@megasaver/indexer";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { maintainCacheAdviceStore } from "../src/hooks/cache-advice-maintenance.js";
import {
  cacheAdviceRecordDirectory,
  cacheAdviceRecordId,
} from "../src/hooks/cache-advice-queue.js";
import { cacheAdviceSessionStorageKey } from "../src/hooks/cache-advice-store.js";
import { readSessionIntent } from "../src/hooks/intent-run.js";
import { ensureStoreReady } from "../src/store.js";

// The standalone bundle inlines the TypeScript compiler (via @megasaver/indexer),
// which reads __filename/__dirname at module load. A broken ESM bundle crashes
// on import before any command runs. This guards that regression locally when a
// bundle is present; CI builds the bundle and runs the same smoke unconditionally.
const bundleDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-bundle");
const bundle = join(bundleDir, "mega.mjs");
const distCli = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const taskKickoffWorkerBundle = join(bundleDir, "task-kickoff-worker.mjs");
const hasBundle = existsSync(bundle);
const hasDistCli = existsSync(distCli);
const hasPublishedGui = existsSync(join(bundleDir, "gui", "index.html"));
// biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is an index signature under strict TS.
const packedMega = process.env["MEGASAVER_PACKED_MEGA"];

// Coarse backstop on the single-file bundle (the *.node and onnxruntime_binding
// checks below are the precise guards). The TypeScript compiler stays inlined on
// purpose (~8MB) so `mega index` runs from a bare `node mega.mjs` with no
// node_modules — see tsup.bundle.config.ts. What must NOT be inlined is the
// @huggingface/transformers / onnxruntime-node chain: it drags platform-specific
// *.node binaries (built for ONE CI OS, dead weight everywhere else) into the
// tarball and balloons it past 15MB. Externalized, mega.mjs measures ~11.2MB;
// 12 leaves headroom for normal drift while still catching a transformers re-
// inline (which adds ~2MB of JS and pushes it back past 13MB).
const MAX_BUNDLE_MB = 12;
const STRONG_RUNTIME_CANCEL_ENV = "MEGASAVER_BUNDLE_CANCEL_REQUIRE_GIT_START";
const STRICT_TASK_KICKOFF_DELIVERY_ENV = "MEGASAVER_BUNDLE_REQUIRE_TASK_KICKOFF_DELIVERY";
const tmpdir = () => realpathSync(readTemporaryDirectory());

type RuntimeCancellationEvidenceMode = "normal" | "strong";

function isolatedBundleEnv(root: string): NodeJS.ProcessEnv {
  const home = join(root, "home");
  const data = join(root, "data");
  mkdirSync(home, { recursive: true });
  mkdirSync(data, { recursive: true });
  if (!bundleMaintenanceDisabled()) {
    return { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: data };
  }
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_DATA_HOME: data,
    MEGASAVER_DISABLE_CACHE_ADVICE_MAINTENANCE: "1",
  };
}

let bundleMaintenanceDisabledFlag = false;

function bundleMaintenanceDisabled(): boolean {
  return bundleMaintenanceDisabledFlag;
}

function setBundleMaintenanceDisabled(disabled: boolean): void {
  bundleMaintenanceDisabledFlag = disabled;
}

function runCacheAdviceArtifact(
  executable: string,
  usesNodeLauncher: boolean,
  storeRoot: string,
  projectRoot: string,
  sessionId: string,
): { first: string; second: string; third: string; statePath: string } {
  const target = join(projectRoot, "src", "auth.ts");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, "export const auth = true;\n");
  const args = ["hooks", "cache-advice", "--store", storeRoot];
  const payload = JSON.stringify({
    session_id: sessionId,
    cwd: projectRoot,
    tool_name: "Read",
    tool_input: { file_path: target },
  });
  const command = usesNodeLauncher ? process.execPath : executable;
  const commandArgs = usesNodeLauncher ? [executable, ...args] : args;
  const options = {
    cwd: projectRoot,
    encoding: "utf8" as const,
    input: payload,
    timeout: 5_000,
    env: isolatedBundleEnv(projectRoot),
  };
  const first = execFileSync(command, commandArgs, options);
  const second = execFileSync(command, commandArgs, options);
  const third = execFileSync(command, commandArgs, options);
  return {
    first,
    second,
    third,
    statePath: join(
      cacheAdviceRecordDirectory(
        storeRoot,
        cacheAdviceRecordId({
          workspaceKey: encodeWorkspaceKey(projectRoot),
          sessionStorageKey: cacheAdviceSessionStorageKey(sessionId),
        }),
      ),
      "state.json",
    ),
  };
}

function runBashCacheAdviceArtifact(
  executable: string,
  usesNodeLauncher: boolean,
  storeRoot: string,
  projectRoot: string,
  sessionId: string,
  command: string,
): string {
  const args = ["hooks", "cache-advice", "--store", storeRoot];
  const payload = JSON.stringify({
    session_id: sessionId,
    cwd: projectRoot,
    tool_name: "Bash",
    tool_input: { command },
  });
  return execFileSync(
    usesNodeLauncher ? process.execPath : executable,
    [...(usesNodeLauncher ? [executable] : []), ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      input: payload,
      timeout: 5_000,
      env: isolatedBundleEnv(projectRoot),
    },
  );
}

// Output-route artifact evidence (phases 3-4 amendment §3): through the real
// public executable, an eligible grammar emits only additionalContext (never
// command text), a shell-bearing form emits nothing, and no state leaks the
// command. The registry gates cannot pass without a registered project, so
// this proves the fail-closed artifact path plus the parser boundary.
function assertOutputRouteArtifactContract(
  executable: string,
  usesNodeLauncher: boolean,
  fixturePrefix: string,
): void {
  const root = mkdtempSync(join(tmpdir(), fixturePrefix));
  const storeRoot = join(root, "store");
  const projectRoot = join(root, "project");
  const secretPattern = "ARTIFACT_OUTPUT_ROUTE_SECRET_PATTERN";
  try {
    mkdirSync(projectRoot, { mode: 0o700 });
    // No registered project/session exists in the isolated store: every gate
    // downstream of the parser fails closed, so even an eligible grammar
    // emits nothing and persists nothing.
    const eligible = runBashCacheAdviceArtifact(
      executable,
      usesNodeLauncher,
      storeRoot,
      projectRoot,
      "artifact-output-route",
      `grep -r -e ${secretPattern} -- src`,
    );
    const shellForm = runBashCacheAdviceArtifact(
      executable,
      usesNodeLauncher,
      storeRoot,
      projectRoot,
      "artifact-output-route",
      `grep -r -e ${secretPattern} -- src | head`,
    );
    expect(eligible).toBe("");
    expect(shellForm).toBe("");
    if (existsSync(storeRoot)) {
      expect(everyFileContentUnder(storeRoot)).not.toContain(secretPattern);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertWindowsCacheAdviceArtifactContract(executable: string, fixturePrefix: string): void {
  const root = mkdtempSync(join(tmpdir(), fixturePrefix));
  const storeRoot = join(root, "store");
  const projectRoot = join(root, "project");
  const preload = join(root, "force-win32.cjs");
  try {
    mkdirSync(projectRoot, { mode: 0o700 });
    writeFileSync(preload, 'Object.defineProperty(process, "platform", { value: "win32" });\n');
    const target = join(projectRoot, "auth.ts");
    writeFileSync(target, "export const auth = true;\n");
    const output = execFileSync(
      process.execPath,
      ["--require", preload, executable, "hooks", "cache-advice", "--store", storeRoot],
      {
        cwd: projectRoot,
        encoding: "utf8",
        input: JSON.stringify({
          session_id: "windows-artifact-cache-advice",
          cwd: projectRoot,
          tool_name: "Read",
          tool_input: { file_path: target },
        }),
        timeout: 5_000,
        env: isolatedBundleEnv(root),
      },
    );
    expect(output).toBe("");
    expect(existsSync(storeRoot)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertCacheAdviceArtifactContract(
  executable: string,
  usesNodeLauncher: boolean,
  fixturePrefix: string,
): void {
  const root = mkdtempSync(join(tmpdir(), fixturePrefix));
  const storeRoot = join(root, "store");
  const projectRoot = join(root, "project");
  try {
    mkdirSync(projectRoot, { mode: 0o700 });
    const result = runCacheAdviceArtifact(
      executable,
      usesNodeLauncher,
      storeRoot,
      projectRoot,
      "artifact-cache-advice",
    );
    expect(result.first).toBe("");
    const response = JSON.parse(result.second) as {
      hookSpecificOutput: Record<string, unknown>;
    };
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: expect.any(String),
      },
    });
    expect(response.hookSpecificOutput).not.toHaveProperty("permissionDecision");
    const rawState = readFileSync(result.statePath, "utf8");
    expect(Buffer.byteLength(rawState)).toBeLessThanOrEqual(32_768);
    expect(JSON.parse(rawState)).toMatchObject({ version: 3 });
    expect(rawState).not.toContain(projectRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function prepareLegacyCacheAdviceDirectory(storeRoot: string, workspaceKey: string): string {
  const directory = join(storeRoot, "stats", workspaceKey, "cache-advice");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(storeRoot, 0o700);
  chmodSync(join(storeRoot, "stats"), 0o700);
  chmodSync(join(storeRoot, "stats", workspaceKey), 0o700);
  chmodSync(directory, 0o700);
  return directory;
}

function writeLegacyCacheAdviceState(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
  content: string,
): string {
  const directory = prepareLegacyCacheAdviceDirectory(storeRoot, workspaceKey);
  const path = join(directory, `${cacheAdviceSessionStorageKey(sessionId)}.json`);
  writeFileSync(path, content, { mode: 0o600 });
  return path;
}

function everyFileContentUnder(root: string): string {
  const collected: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        walk(path);
      } else if (stats.isFile()) {
        collected.push(readFileSync(path, "utf8"));
      }
    }
  };
  if (existsSync(root)) walk(root);
  return collected.join("\n");
}

// Seeds a strict v2 legacy flat snapshot, proves the public executable
// suppresses advice while migration is incomplete, completes the migration
// through the off-hook maintainer, then proves the same executable serves the
// advice-only v3 path with no permissionDecision.
async function assertCacheAdviceV3MigrationArtifactContract(
  executable: string,
  usesNodeLauncher: boolean,
  fixturePrefix: string,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), fixturePrefix));
  const storeRoot = join(root, "store");
  const projectRoot = join(root, "project");
  const sessionId = "artifact-v3-migration";
  try {
    mkdirSync(projectRoot, { mode: 0o700 });
    const workspaceKey = encodeWorkspaceKey(projectRoot);
    const legacyPath = writeLegacyCacheAdviceState(
      storeRoot,
      workspaceKey,
      sessionId,
      `${JSON.stringify({
        version: 2,
        offeredDirectoryKeys: [],
        recent: [],
      })}\n`,
    );
    const result = runCacheAdviceArtifact(
      executable,
      usesNodeLauncher,
      storeRoot,
      projectRoot,
      sessionId,
    );
    expect(result.first).toBe("");
    expect(result.second).toBe("");
    expect(result.third).toBe("");
    expect(existsSync(legacyPath)).toBe(true);
    expect(await maintainCacheAdviceStore({ storeRoot, now: Date.now() })).toBe("complete");
    expect(existsSync(legacyPath)).toBe(false);
    // Every pre-migration call was suppressed (the hook fences the legacy
    // tree), and the empty seeded snapshot migrated verbatim. The two
    // post-migration calls run the live v3 path: the first records through
    // the migrated capsule, the second advises.
    const post = runCacheAdviceArtifact(
      executable,
      usesNodeLauncher,
      storeRoot,
      projectRoot,
      sessionId,
    );
    expect(post.first).toBe("");
    const response = JSON.parse(post.second) as {
      hookSpecificOutput: Record<string, unknown>;
    };
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: expect.any(String),
      },
    });
    expect(response.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Privacy acceptance evidence (spec §3): after a legacy tree carrying a raw
// session id, cwd, path, URL, and secret migrates, no file anywhere under the
// store root may still contain any of those raw strings.
async function assertCacheAdviceStorePrivacyAfterMigration(fixturePrefix: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), fixturePrefix));
  const storeRoot = join(root, "store");
  const projectRoot = join(root, "project");
  const sessionId = "11111111-2222-4333-8444-555555555555";
  const fakeSecret = "FAKE_SECRET_TOKEN_9f8e";
  const fakeUrl = "https://internal.example.invalid/x";
  const fakePath = "/Users/alice/secret-project";
  try {
    mkdirSync(projectRoot, { mode: 0o700 });
    const workspaceKey = encodeWorkspaceKey(projectRoot);
    // The legacy payload carries the raw strings exactly as an old binary
    // could have left them; the file is oversized relative to the strict v2
    // envelope, so the maintainer must suppress rather than migrate it.
    const rawLegacyPayload = JSON.stringify({
      version: 2,
      session: sessionId,
      cwd: projectRoot,
      note: `${fakeSecret} ${fakeUrl} ${fakePath}`,
    });
    const legacyPath = writeLegacyCacheAdviceState(
      storeRoot,
      workspaceKey,
      sessionId,
      rawLegacyPayload,
    );
    expect(rawLegacyPayload).toContain(sessionId);
    expect(await maintainCacheAdviceStore({ storeRoot, now: Date.now() })).toBe("complete");
    expect(existsSync(legacyPath)).toBe(false);
    const everything = everyFileContentUnder(storeRoot);
    expect(everything).not.toBe("");
    expect(everything).not.toContain(sessionId);
    expect(everything).not.toContain(projectRoot);
    expect(everything).not.toContain(fakeSecret);
    expect(everything).not.toContain(fakeUrl);
    expect(everything).not.toContain(fakePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertWindowsCacheAdviceMaintainContract(executable: string, fixturePrefix: string): void {
  const root = mkdtempSync(join(tmpdir(), fixturePrefix));
  const storeRoot = join(root, "store");
  const preload = join(root, "force-win32.cjs");
  try {
    writeFileSync(preload, 'Object.defineProperty(process, "platform", { value: "win32" });\n');
    const output = execFileSync(
      process.execPath,
      ["--require", preload, executable, "hooks", "cache-advice-maintain", "--store", storeRoot],
      { encoding: "utf8", timeout: 5_000, env: isolatedBundleEnv(root) },
    );
    expect(output).toBe("");
    expect(existsSync(storeRoot)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertTaskKickoffBundleResult(
  platform: NodeJS.Platform,
  out: string,
  events: readonly unknown[],
): boolean {
  if (platform === "win32") {
    expect(out).toBe("");
    expect(events).toEqual([]);
    return false;
  }
  if (out === "") {
    expect(events).toEqual([]);
    return false;
  }
  expect(JSON.parse(out)).toMatchObject({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
    },
  });
  expect(events).toHaveLength(1);
  return true;
}

function runRawBundleTaskKickoff(
  rawBundle: string,
  storeRoot: string,
  projectRoot: string,
  sessionId: string,
  missingFsExtPreload: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--no-global-search-paths",
        "--require",
        missingFsExtPreload,
        rawBundle,
        "hooks",
        "intent",
        "--store",
        storeRoot,
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, NODE_PATH: "" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(`raw bundle task kickoff exited ${code} (${signal}): ${stderr}`));
    });
    child.stdin.end(
      JSON.stringify({ prompt: "repair auth", cwd: projectRoot, session_id: sessionId }),
    );
  });
}

async function assertDelayedGitIsCancelled(
  runtime: string,
  evidenceMode: RuntimeCancellationEvidenceMode = process.env[STRONG_RUNTIME_CANCEL_ENV] === "1"
    ? "strong"
    : "normal",
  requireCapturedIntent = false,
): Promise<void> {
  const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-runtime-cancel-store-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "megasaver-runtime-cancel-project-"));
  const fakeBin = mkdtempSync(join(tmpdir(), "megasaver-runtime-cancel-bin-"));
  const startedMarker = join(fakeBin, "git-started");
  const lateMarker = join(fakeBin, "git-survived");
  const earlyIntentMissingMarker = join(fakeBin, "intent-missing-before-git-cancel");
  const intentPath = join(
    storeRoot,
    "stats",
    encodeWorkspaceKey(projectRoot),
    "intent",
    "runtime-cancel-smoke.json",
  );
  try {
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(
      join(projectRoot, "src", "auth.ts"),
      "export function repairAuth(token: string) { return token.length > 0; }\n",
    );
    const projectId = "11111111-1111-4111-8111-111111111111";
    const now = "2026-08-01T10:00:00.000Z";
    const { registry } = await ensureStoreReady(storeRoot);
    registry.createProject({
      id: projectId,
      name: "runtime-cancel-smoke",
      rootPath: projectRoot,
      createdAt: now,
      updatedAt: now,
    } as never);
    await buildIndex({
      rootDir: projectRoot,
      storeDir: storeRoot,
      projectId: projectId as never,
    });
    writeFileSync(
      join(fakeBin, "git"),
      [
        "#!/bin/sh",
        'if [ "$MEGASAVER_GIT_WARM_MODE" = "1" ]; then exit 0; fi',
        'printf started > "$MEGASAVER_GIT_STARTED_MARKER"',
        'sleep 0.1; if [ ! -f "$MEGASAVER_INTENT_PATH" ]; then printf missing > "$MEGASAVER_GIT_EARLY_INTENT_MISSING_MARKER"; fi',
        '( sleep 0.75; printf survived > "$MEGASAVER_GIT_LATE_MARKER" ) &',
        "while true; do sleep 1; done",
      ].join("\n"),
      { mode: 0o700 },
    );

    // Strong CI evidence must prove a Git process started before the fixed
    // entry-inclusive 500 ms hook deadline expires. Run the same hook path in
    // a separate disposable session with a harmless immediate Git result,
    // then invoke the actual hook in a fresh process. This warms only the
    // evidence fixture; it does not add a product retry or a second deadline.
    if (evidenceMode === "strong" && process.platform !== "win32") {
      execFileSync(process.execPath, [runtime, "hooks", "intent", "--store", storeRoot], {
        encoding: "utf8",
        env: {
          ...process.env,
          // biome-ignore lint/complexity/useLiteralKeys: PATH is the executable lookup boundary.
          PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
          MEGASAVER_GIT_STARTED_MARKER: startedMarker,
          MEGASAVER_GIT_LATE_MARKER: lateMarker,
          MEGASAVER_GIT_EARLY_INTENT_MISSING_MARKER: earlyIntentMissingMarker,
          MEGASAVER_INTENT_PATH: intentPath,
          MEGASAVER_GIT_WARM_MODE: "1",
        },
        input: JSON.stringify({
          prompt: "prepare runtime cancellation evidence",
          cwd: projectRoot,
          session_id: "runtime-cancel-prewarm",
        }),
        timeout: 5_000,
      });
    }

    const out = execFileSync(process.execPath, [runtime, "hooks", "intent", "--store", storeRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        // biome-ignore lint/complexity/useLiteralKeys: PATH is the executable lookup boundary.
        PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
        MEGASAVER_GIT_STARTED_MARKER: startedMarker,
        MEGASAVER_GIT_LATE_MARKER: lateMarker,
        MEGASAVER_GIT_EARLY_INTENT_MISSING_MARKER: earlyIntentMissingMarker,
        MEGASAVER_INTENT_PATH: intentPath,
      },
      input: JSON.stringify({
        prompt: "repair auth",
        cwd: projectRoot,
        session_id: "runtime-cancel-smoke",
      }),
      // The dist CLI loads the full bundle before this hook's 500 ms
      // deadline even starts; on a contended Windows CI runner that alone can
      // approach 5 s. Widened after an observed ETIMEDOUT — the process
      // still exits well inside this ceiling on green runs.
      timeout: 15_000,
    });

    expect(out).toBe("");
    if (evidenceMode === "strong" && process.platform !== "win32" && !existsSync(startedMarker)) {
      throw new Error("strong cancellation evidence requires fake Git to start");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (existsSync(lateMarker)) {
      throw new Error("fake Git survived cancellation");
    }
    if (requireCapturedIntent) {
      expect(
        readSessionIntent(
          storeRoot,
          encodeWorkspaceKey(projectRoot),
          "runtime-cancel-smoke",
          Date.now,
        ),
      ).toBe("repair auth");
      expect(existsSync(earlyIntentMissingMarker)).toBe(false);
    }
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
}

describe("standalone CLI bundle", () => {
  it.skipIf(!hasBundle || process.platform === "win32")(
    "runs cache advice twice through the freshly built public bundle",
    () => assertCacheAdviceArtifactContract(bundle, true, "megasaver-bundle-cache-advice-"),
  );

  it.skipIf(packedMega === undefined || process.platform === "win32")(
    "runs cache advice twice through the installed packed mega bin",
    () =>
      assertCacheAdviceArtifactContract(
        packedMega ?? "missing-packed-mega",
        false,
        "megasaver-packed-cache-advice-",
      ),
  );

  it.skipIf(!hasBundle)("keeps fresh bundle cache advice disabled on Windows without state", () =>
    assertWindowsCacheAdviceArtifactContract(bundle, "megasaver-bundle-cache-advice-win32-"),
  );

  it.skipIf(!hasBundle || process.platform === "win32")(
    "closes every output-route gate through the freshly built public bundle",
    () =>
      assertOutputRouteArtifactContract(bundle, true, "megasaver-bundle-output-route-artifact-"),
  );

  it.skipIf(packedMega === undefined || process.platform === "win32")(
    "closes every output-route gate through the installed packed mega bin",
    () =>
      assertOutputRouteArtifactContract(
        packedMega ?? "missing-packed-mega",
        false,
        "megasaver-packed-output-route-artifact-",
      ),
  );

  it.skipIf(packedMega === undefined)(
    "keeps installed packed cache advice disabled on Windows without state",
    () =>
      assertWindowsCacheAdviceArtifactContract(
        packedMega ?? "missing-packed-mega",
        "megasaver-packed-cache-advice-win32-",
      ),
  );

  it.skipIf(!hasBundle || process.platform === "win32")(
    "migrates a legacy flat v2 tree before serving advice through the freshly built public bundle",
    async () => {
      // The hook's best-effort detached maintainer is covered separately by the
      // Task 4 maintenance suite; this artifact case drives migration in-process.
      setBundleMaintenanceDisabled(true);
      try {
        await assertCacheAdviceV3MigrationArtifactContract(
          bundle,
          true,
          "megasaver-bundle-cache-advice-v3-",
        );
      } finally {
        setBundleMaintenanceDisabled(false);
      }
    },
  );

  it.skipIf(packedMega === undefined || process.platform === "win32")(
    "migrates a legacy flat v2 tree before serving advice through the installed packed mega bin",
    async () => {
      setBundleMaintenanceDisabled(true);
      try {
        await assertCacheAdviceV3MigrationArtifactContract(
          packedMega ?? "missing-packed-mega",
          false,
          "megasaver-packed-cache-advice-v3-",
        );
      } finally {
        setBundleMaintenanceDisabled(false);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "leaves no raw session, path, URL, or secret anywhere after legacy migration",
    () => assertCacheAdviceStorePrivacyAfterMigration("megasaver-cache-advice-privacy-"),
  );

  it.skipIf(!hasBundle)(
    "keeps fresh bundle cache-advice-maintain disabled on Windows without state",
    () =>
      assertWindowsCacheAdviceMaintainContract(
        bundle,
        "megasaver-bundle-cache-advice-maintain-win32-",
      ),
  );

  it.skipIf(!hasBundle || process.platform === "win32")(
    "fails open in a copied raw bundle when cache advice state setup is unsafe",
    () => {
      const root = mkdtempSync(join(tmpdir(), "megasaver-raw-cache-advice-"));
      const rawBundle = join(root, "mega.mjs");
      const projectRoot = join(root, "project");
      const storeRoot = join(root, "store");
      const external = join(root, "external");
      const cacheParent = join(storeRoot, "stats");
      try {
        copyFileSync(bundle, rawBundle);
        mkdirSync(projectRoot, { mode: 0o700 });
        mkdirSync(cacheParent, { recursive: true, mode: 0o700 });
        mkdirSync(external, { mode: 0o700 });
        writeFileSync(join(external, "sentinel"), "unchanged");
        symlinkSync(external, join(cacheParent, "cache-advice-v3"), "dir");
        const target = join(projectRoot, "auth.ts");
        writeFileSync(target, "export {};\n");
        const output = execFileSync(
          process.execPath,
          [rawBundle, "hooks", "cache-advice", "--store", storeRoot],
          {
            cwd: projectRoot,
            encoding: "utf8",
            input: JSON.stringify({
              session_id: "raw-cache-advice",
              cwd: projectRoot,
              tool_name: "Read",
              tool_input: { file_path: target },
            }),
            timeout: 5_000,
            env: isolatedBundleEnv(root),
          },
        );

        expect(output).toBe("");
        expect(readdirSync(external)).toEqual(["sentinel"]);
        expect(readFileSync(join(external, "sentinel"), "utf8")).toBe("unchanged");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasBundle)(
    "runs `doctor` from the built mega.mjs (exit 0, no ESM-global crash)",
    () => {
      const isolatedRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-doctor-"));
      try {
        const out = execFileSync(process.execPath, [bundle, "doctor"], {
          encoding: "utf8",
          env: isolatedBundleEnv(isolatedRoot),
        });
        expect(out).toContain("PASS");
        expect(out).toContain("0 FAIL");
      } finally {
        rmSync(isolatedRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasBundle)("runs task kickoff inside the single published bundle", async () => {
    expect(existsSync(taskKickoffWorkerBundle)).toBe(false);
    const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-kickoff-store-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-kickoff-project-"));
    try {
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src", "auth.ts"),
        "export function repairAuth(token: string) { return token.length > 0; }\n",
      );
      const projectId = "11111111-1111-4111-8111-111111111111";
      const now = "2026-08-01T10:00:00.000Z";
      const { registry } = await ensureStoreReady(storeRoot);
      registry.createProject({
        id: projectId,
        name: "bundle-smoke",
        rootPath: projectRoot,
        createdAt: now,
        updatedAt: now,
      } as never);
      await buildIndex({
        rootDir: projectRoot,
        storeDir: storeRoot,
        projectId: projectId as never,
      });
      const out = execFileSync(
        process.execPath,
        [bundle, "hooks", "intent", "--store", storeRoot],
        {
          encoding: "utf8",
          input: JSON.stringify({
            prompt: "repair auth",
            cwd: projectRoot,
            session_id: "bundle-smoke",
          }),
          timeout: 5_000,
        },
      );
      const events = readTaskKickoffEvents({ root: storeRoot }, encodeWorkspaceKey(projectRoot));
      assertTaskKickoffBundleResult(process.platform, out, events);
      // Windows CI supplies the real result; keep its assertion branch live on POSIX too
      // without mutating the process-wide platform property.
      assertTaskKickoffBundleResult("win32", "", []);
      const latestIntent = readSessionIntent(
        storeRoot,
        encodeWorkspaceKey(projectRoot),
        "bundle-smoke",
        Date.now,
      );
      expect([undefined, "repair auth"]).toContain(latestIntent);
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasBundle)(
    "handles a raw bundle without fs-ext within the Task Kickoff deadline",
    async () => {
      const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-raw-bundle-kickoff-store-"));
      const projectRoot = mkdtempSync(join(tmpdir(), "megasaver-raw-bundle-kickoff-project-"));
      const rawBundleRoot = mkdtempSync(join(tmpdir(), "megasaver-raw-bundle-kickoff-bin-"));
      const rawBundle = join(rawBundleRoot, "mega.mjs");
      const missingFsExtPreload = join(rawBundleRoot, "missing-fs-ext.cjs");
      try {
        copyFileSync(bundle, rawBundle);
        writeFileSync(
          missingFsExtPreload,
          [
            'const Module = require("node:module");',
            "const originalLoad = Module._load;",
            "Module._load = function loadWithoutFsExt(id, parent, isMain) {",
            '  if (id === "fs-ext") {',
            '    const error = new Error("fs-ext is unavailable");',
            '    error.code = "MODULE_NOT_FOUND";',
            "    throw error;",
            "  }",
            "  return originalLoad.call(this, id, parent, isMain);",
            "};",
          ].join("\n"),
        );
        mkdirSync(join(projectRoot, "src"), { recursive: true });
        writeFileSync(
          join(projectRoot, "src", "auth.ts"),
          "export function repairAuth(token: string) { return token.length > 0; }\n",
        );
        const { registry } = await ensureStoreReady(storeRoot);
        registry.createProject({
          id: "11111111-1111-4111-8111-111111111111",
          name: "raw-bundle-smoke",
          rootPath: projectRoot,
          createdAt: "2026-08-01T10:00:00.000Z",
          updatedAt: "2026-08-01T10:00:00.000Z",
        } as never);
        await buildIndex({
          rootDir: projectRoot,
          storeDir: storeRoot,
          projectId: "11111111-1111-4111-8111-111111111111" as never,
        });

        const output = [
          await runRawBundleTaskKickoff(
            rawBundle,
            storeRoot,
            projectRoot,
            "raw-bundle-one",
            missingFsExtPreload,
          ),
        ];
        const events = readTaskKickoffEvents({ root: storeRoot }, encodeWorkspaceKey(projectRoot));

        if (output[0] === "") {
          expect(events).toEqual([]);
          return;
        }
        for (const row of output) {
          expect(JSON.parse(row)).toMatchObject({
            hookSpecificOutput: { hookEventName: "UserPromptSubmit" },
          });
        }
        expect(events.map((event) => event.sessionId)).toEqual(["raw-bundle-one"]);
        expect(
          readFileSync(
            join(storeRoot, "stats", encodeWorkspaceKey(projectRoot), "task-kickoff.jsonl"),
            "utf8",
          ),
        ).toBe("");
        expect(
          existsSync(
            join(storeRoot, "stats", encodeWorkspaceKey(projectRoot), "task-kickoff-parts"),
          ),
        ).toBe(true);
      } finally {
        rmSync(storeRoot, { recursive: true, force: true });
        rmSync(projectRoot, { recursive: true, force: true });
        rmSync(rawBundleRoot, { recursive: true, force: true });
      }
    },
    10_000,
  );

  it.skipIf(!hasBundle || process.platform === "win32")(
    "does not initialize an empty external target through a stable store-root symlink",
    () => {
      const outsideStore = mkdtempSync(join(tmpdir(), "megasaver-bundle-empty-outside-store-"));
      const linkParent = mkdtempSync(join(tmpdir(), "megasaver-bundle-empty-store-link-"));
      const linkedStore = join(linkParent, "store");
      const cwd = mkdtempSync(join(tmpdir(), "megasaver-bundle-empty-store-cwd-"));
      try {
        symlinkSync(outsideStore, linkedStore, "dir");

        const out = execFileSync(
          process.execPath,
          [bundle, "hooks", "intent", "--store", linkedStore],
          {
            encoding: "utf8",
            input: JSON.stringify({
              prompt: "repair auth",
              cwd,
              session_id: "empty-store-root-symlink",
            }),
            timeout: 5_000,
          },
        );

        expect(out).toBe("");
        expect(readdirSync(outsideStore)).toEqual([]);
        expect(readTaskKickoffEvents({ root: outsideStore }, encodeWorkspaceKey(cwd))).toEqual([]);
        expect(
          readSessionIntent(
            outsideStore,
            encodeWorkspaceKey(cwd),
            "empty-store-root-symlink",
            Date.now,
          ),
        ).toBeUndefined();
      } finally {
        rmSync(linkParent, { recursive: true, force: true });
        rmSync(outsideStore, { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasBundle || process.platform === "win32")(
    "does not initialize an empty external target through lexical store-root symlink spellings",
    () => {
      for (const suffix of ["/", "/."]) {
        const outsideStore = mkdtempSync(join(tmpdir(), "megasaver-bundle-lexical-outside-store-"));
        const linkParent = mkdtempSync(join(tmpdir(), "megasaver-bundle-lexical-store-link-"));
        const linkedStore = join(linkParent, "store");
        const cwd = mkdtempSync(join(tmpdir(), "megasaver-bundle-lexical-store-cwd-"));
        try {
          symlinkSync(outsideStore, linkedStore, "dir");

          const out = execFileSync(
            process.execPath,
            [bundle, "hooks", "intent", "--store", `${linkedStore}${suffix}`],
            {
              encoding: "utf8",
              input: JSON.stringify({
                prompt: "repair auth",
                cwd,
                session_id: `lexical-store-root-${suffix === "/" ? "separator" : "dot"}`,
              }),
              timeout: 5_000,
            },
          );

          expect(out).toBe("");
          expect(readdirSync(outsideStore)).toEqual([]);
          expect(readTaskKickoffEvents({ root: outsideStore }, encodeWorkspaceKey(cwd))).toEqual(
            [],
          );
        } finally {
          rmSync(linkParent, { recursive: true, force: true });
          rmSync(outsideStore, { recursive: true, force: true });
          rmSync(cwd, { recursive: true, force: true });
        }
      }
    },
  );

  it.skipIf(!hasBundle || process.platform === "win32")(
    "does not write intent through a stable store-root symlink",
    async () => {
      const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-symlink-store-"));
      const projectRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-symlink-project-"));
      const linkedStore = join(tmpdir(), `megasaver-bundle-symlink-link-${Date.now()}`);
      const sessionId = "store-root-symlink";
      try {
        symlinkSync(storeRoot, linkedStore, "dir");
        mkdirSync(join(projectRoot, "src"), { recursive: true });
        writeFileSync(
          join(projectRoot, "src", "auth.ts"),
          "export function repairAuth(token: string) { return token.length > 0; }\n",
        );
        const projectId = "11111111-1111-4111-8111-111111111111";
        const now = "2026-08-01T10:00:00.000Z";
        const { registry } = await ensureStoreReady(storeRoot);
        registry.createProject({
          id: projectId,
          name: "store-root-symlink",
          rootPath: projectRoot,
          createdAt: now,
          updatedAt: now,
        } as never);
        await buildIndex({
          rootDir: projectRoot,
          storeDir: storeRoot,
          projectId: projectId as never,
        });

        const out = execFileSync(
          process.execPath,
          [bundle, "hooks", "intent", "--store", linkedStore],
          {
            encoding: "utf8",
            input: JSON.stringify({
              prompt: "repair auth",
              cwd: projectRoot,
              session_id: sessionId,
            }),
            timeout: 5_000,
          },
        );

        const workspaceKey = encodeWorkspaceKey(projectRoot);
        expect(out).toBe("");
        expect(readSessionIntent(storeRoot, workspaceKey, sessionId, Date.now)).toBeUndefined();
        expect(existsSync(join(storeRoot, "stats", workspaceKey, "session-intent.json"))).toBe(
          false,
        );
        expect(readTaskKickoffEvents({ root: storeRoot }, workspaceKey)).toEqual([]);
      } finally {
        rmSync(linkedStore, { force: true });
        rmSync(storeRoot, { recursive: true, force: true });
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasBundle || process.platform === "win32")(
    "skips an unsafe nested-cwd intent directory while delivering task kickoff",
    async () => {
      const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-symlink-store-"));
      const projectRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-symlink-project-"));
      const outsideIntent = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-symlink-outside-"));
      const sessionId = "intent-directory-symlink";
      try {
        mkdirSync(join(projectRoot, "src"), { recursive: true });
        writeFileSync(
          join(projectRoot, "src", "auth.ts"),
          "export function repairAuth(token: string) { return token.length > 0; }\n",
        );
        const projectId = "11111111-1111-4111-8111-111111111111";
        const now = "2026-08-01T10:00:00.000Z";
        const { registry } = await ensureStoreReady(storeRoot);
        registry.createProject({
          id: projectId,
          name: "intent-directory-symlink",
          rootPath: projectRoot,
          createdAt: now,
          updatedAt: now,
        } as never);
        await buildIndex({
          rootDir: projectRoot,
          storeDir: storeRoot,
          projectId: projectId as never,
        });
        const nestedCwd = join(projectRoot, "src");
        const intentWorkspaceKey = encodeWorkspaceKey(nestedCwd);
        const taskWorkspaceKey = encodeWorkspaceKey(projectRoot);
        const workspaceDirectory = join(storeRoot, "stats", intentWorkspaceKey);
        mkdirSync(workspaceDirectory, { recursive: true });
        writeFileSync(join(outsideIntent, "outside"), "unchanged", { mode: 0o640 });
        symlinkSync(outsideIntent, join(workspaceDirectory, "intent"), "dir");

        const out = execFileSync(
          process.execPath,
          [bundle, "hooks", "intent", "--store", storeRoot],
          {
            encoding: "utf8",
            input: JSON.stringify({
              prompt: "repair auth",
              cwd: nestedCwd,
              session_id: sessionId,
            }),
            timeout: 5_000,
          },
        );

        const delivered = assertTaskKickoffBundleResult(
          process.platform,
          out,
          readTaskKickoffEvents({ root: storeRoot }, taskWorkspaceKey),
        );
        expect(readFileSync(join(outsideIntent, "outside"), "utf8")).toBe("unchanged");
        expect(existsSync(join(outsideIntent, `${sessionId}.json`))).toBe(false);
        if (delivered) {
          expect(
            existsSync(join(storeRoot, "stats", "task-kickoff-sessions", `${sessionId}.json`)),
          ).toBe(true);
          expect(
            existsSync(
              join(storeRoot, "stats", taskWorkspaceKey, "task-pack", `${sessionId}.json`),
            ),
          ).toBe(true);
        }
      } finally {
        rmSync(storeRoot, { recursive: true, force: true });
        rmSync(projectRoot, { recursive: true, force: true });
        rmSync(outsideIntent, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasBundle)(
    "captures the latest prompt after a same-session kickoff claim",
    async () => {
      const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-latest-store-"));
      const projectRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-latest-project-"));
      const sessionId = "same-session-latest-intent";
      try {
        mkdirSync(join(projectRoot, "src"), { recursive: true });
        writeFileSync(
          join(projectRoot, "src", "auth.ts"),
          "export function repairAuth(token: string) { return token.length > 0; }\n",
        );
        const projectId = "11111111-1111-4111-8111-111111111111";
        const now = "2026-08-01T10:00:00.000Z";
        const { registry } = await ensureStoreReady(storeRoot);
        registry.createProject({
          id: projectId,
          name: "same-session-latest-intent",
          rootPath: projectRoot,
          createdAt: now,
          updatedAt: now,
        } as never);
        await buildIndex({
          rootDir: projectRoot,
          storeDir: storeRoot,
          projectId: projectId as never,
        });
        const invoke = (prompt: string) =>
          execFileSync(process.execPath, [bundle, "hooks", "intent", "--store", storeRoot], {
            encoding: "utf8",
            input: JSON.stringify({ prompt, cwd: projectRoot, session_id: sessionId }),
            timeout: 5_000,
          });

        const first = invoke("first prompt");
        if (process.platform === "win32") expect(first).toBe("");
        else if (process.env[STRICT_TASK_KICKOFF_DELIVERY_ENV] === "1" || first !== "") {
          expect(JSON.parse(first)).toMatchObject({
            hookSpecificOutput: { hookEventName: "UserPromptSubmit" },
          });
        }
        expect(invoke("second prompt")).toBe("");
        const latestIntent = readSessionIntent(
          storeRoot,
          encodeWorkspaceKey(projectRoot),
          sessionId,
          Date.now,
        );
        if (process.platform === "win32" || process.env[STRICT_TASK_KICKOFF_DELIVERY_ENV] === "1") {
          expect(latestIntent).toBe("second prompt");
        } else {
          expect([undefined, "first prompt", "second prompt"]).toContain(latestIntent);
        }
      } finally {
        rmSync(storeRoot, { recursive: true, force: true });
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasBundle)("captures intent for an unindexed no-output prompt", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-unindexed-store-"));
    const cwd = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-unindexed-cwd-"));
    const sessionId = "unindexed-latest-intent";
    try {
      const out = execFileSync(
        process.execPath,
        [bundle, "hooks", "intent", "--store", storeRoot],
        {
          encoding: "utf8",
          input: JSON.stringify({ prompt: "remember this prompt", cwd, session_id: sessionId }),
          timeout: 5_000,
        },
      );

      expect(out).toBe("");
      const latestIntent = readSessionIntent(
        storeRoot,
        encodeWorkspaceKey(cwd),
        sessionId,
        Date.now,
      );
      if (process.env[STRICT_TASK_KICKOFF_DELIVERY_ENV] === "1") {
        expect(latestIntent).toBe("remember this prompt");
      } else {
        expect([undefined, "remember this prompt"]).toContain(latestIntent);
      }
      expect(readTaskKickoffEvents({ root: storeRoot }, encodeWorkspaceKey(cwd))).toEqual([]);
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasBundle)("initializes a fresh default store before capturing intent", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-fresh-default-store-"));
    const home = join(fixtureRoot, "home");
    const cwd = mkdtempSync(join(tmpdir(), "megasaver-bundle-fresh-default-cwd-"));
    const sessionId = "fresh-default-store";
    const storeRoot = join(home, ".local", "share", "megasaver");
    try {
      mkdirSync(home);
      const out = execFileSync(process.execPath, [bundle, "hooks", "intent"], {
        encoding: "utf8",
        env: { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: "" },
        input: JSON.stringify({ prompt: "remember default store", cwd, session_id: sessionId }),
        timeout: 5_000,
      });

      expect(out).toBe("");
      const projectsPath = join(storeRoot, "projects.json");
      const sessionsPath = join(storeRoot, "sessions.json");
      const intent = readSessionIntent(storeRoot, encodeWorkspaceKey(cwd), sessionId, Date.now);
      if (process.env[STRICT_TASK_KICKOFF_DELIVERY_ENV] === "1") {
        expect(JSON.parse(readFileSync(projectsPath, "utf8"))).toEqual([]);
        expect(JSON.parse(readFileSync(sessionsPath, "utf8"))).toEqual([]);
        expect(intent).toBe("remember default store");
      } else {
        expect(existsSync(projectsPath)).toBe(existsSync(sessionsPath));
        expect([undefined, "remember default store"]).toContain(intent);
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasBundle)("initializes a nested custom store before capturing intent", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-nested-store-"));
    const cwd = mkdtempSync(join(tmpdir(), "megasaver-bundle-nested-store-cwd-"));
    const sessionId = "nested-custom-store";
    const storeRoot = join(fixtureRoot, "one", "two", "megasaver");
    try {
      const out = execFileSync(
        process.execPath,
        [bundle, "hooks", "intent", "--store", storeRoot],
        {
          encoding: "utf8",
          input: JSON.stringify({ prompt: "remember nested store", cwd, session_id: sessionId }),
          timeout: 5_000,
        },
      );

      expect(out).toBe("");
      const projectsPath = join(storeRoot, "projects.json");
      const sessionsPath = join(storeRoot, "sessions.json");
      const intent = readSessionIntent(storeRoot, encodeWorkspaceKey(cwd), sessionId, Date.now);
      if (process.env[STRICT_TASK_KICKOFF_DELIVERY_ENV] === "1") {
        expect(JSON.parse(readFileSync(projectsPath, "utf8"))).toEqual([]);
        expect(JSON.parse(readFileSync(sessionsPath, "utf8"))).toEqual([]);
        expect(intent).toBe("remember nested store");
      } else {
        expect(existsSync(projectsPath)).toBe(existsSync(sessionsPath));
        expect([undefined, "remember nested store"]).toContain(intent);
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasBundle || process.platform === "win32")(
    "fails open when optional intent capture cannot complete",
    async () => {
      const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-failure-store-"));
      const projectRoot = mkdtempSync(join(tmpdir(), "megasaver-bundle-intent-failure-project-"));
      const sessionId = "intent-capture-failure";
      try {
        mkdirSync(join(projectRoot, "src"), { recursive: true });
        writeFileSync(
          join(projectRoot, "src", "auth.ts"),
          "export function repairAuth(token: string) { return token.length > 0; }\n",
        );
        const projectId = "11111111-1111-4111-8111-111111111111";
        const now = "2026-08-01T10:00:00.000Z";
        const { registry } = await ensureStoreReady(storeRoot);
        registry.createProject({
          id: projectId,
          name: "intent-capture-failure",
          rootPath: projectRoot,
          createdAt: now,
          updatedAt: now,
        } as never);
        await buildIndex({
          rootDir: projectRoot,
          storeDir: storeRoot,
          projectId: projectId as never,
        });
        const workspaceKey = encodeWorkspaceKey(projectRoot);
        const intentPath = join(storeRoot, "stats", workspaceKey, "intent", `${sessionId}.json`);
        mkdirSync(intentPath, { recursive: true });

        const out = execFileSync(
          process.execPath,
          [bundle, "hooks", "intent", "--store", storeRoot],
          {
            encoding: "utf8",
            input: JSON.stringify({
              prompt: "repair auth",
              cwd: projectRoot,
              session_id: sessionId,
            }),
            timeout: 5_000,
          },
        );

        const events = readTaskKickoffEvents({ root: storeRoot }, workspaceKey);
        if (out === "") expect(events).toEqual([]);
        else {
          expect(JSON.parse(out)).toMatchObject({
            hookSpecificOutput: { hookEventName: "UserPromptSubmit" },
          });
          expect(events).toHaveLength(1);
          expect(
            existsSync(join(storeRoot, "stats", "task-kickoff-sessions", `${sessionId}.json`)),
          ).toBe(true);
          expect(
            existsSync(join(storeRoot, "stats", workspaceKey, "task-pack", `${sessionId}.json`)),
          ).toBe(true);
        }
      } finally {
        rmSync(storeRoot, { recursive: true, force: true });
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasBundle)(
    "cancels delayed Git in the single published bundle",
    () => assertDelayedGitIsCancelled(bundle),
    20_000,
  );

  it.skipIf(!hasBundle || process.platform === "win32")(
    "captures intent while delayed Git preparation times out",
    () =>
      assertDelayedGitIsCancelled(
        bundle,
        process.env[STRONG_RUNTIME_CANCEL_ENV] === "1" ? "strong" : "normal",
        process.env[STRONG_RUNTIME_CANCEL_ENV] === "1",
      ),
    20_000,
  );

  // Regression guard for the v1.2.0 packaging bug: tsup.bundle.config.ts's
  // noExternal:[/.*/] inlined @huggingface/transformers, copying 6 onnxruntime
  // *.node binaries (CI-built for linux, useless off-linux) into the published
  // tarball. The fix externalizes the transformers/onnxruntime chain; embeddings
  // already load it via a guarded dynamic import, so absence degrades gracefully.
  it.skipIf(!hasBundle)("ships no platform-specific *.node native binaries", () => {
    const natives = readdirSync(bundleDir).filter((f) => f.endsWith(".node"));
    expect(natives).toEqual([]);
  });

  it.skipIf(!hasBundle)("does not inline the onnxruntime native loader", () => {
    const src = readFileSync(bundle, "utf8");
    // This binding name only appears in the bundle if onnxruntime-node was inlined.
    expect(src).not.toContain("onnxruntime_binding");
  });

  it.skipIf(!hasBundle)("does not inline the fs-ext native binding", () => {
    const src = readFileSync(bundle, "utf8");
    expect(src).not.toContain("fs_ext.node");
    expect(src).toContain("fs-ext");
  });

  // @megasaver/brain-sync reaches @aws-sdk/client-s3 via a guarded dynamic import;
  // it's externalized (see tsup.bundle.config.ts) so it doesn't inline ~1.2MB and
  // breach the size guard above. The @smithy/* runtime is aws-sdk-internal — it
  // appears in the bundle ONLY if the SDK was inlined (our own code never imports
  // it), so its absence proves the externalization held. Backstops the coarse size
  // guard against a re-inline masked by trimming elsewhere under the cap.
  it.skipIf(!hasBundle)("does not inline the @aws-sdk/client-s3 chain", () => {
    const src = readFileSync(bundle, "utf8");
    expect(src).not.toContain("@smithy/");
  });

  it.skipIf(!hasBundle)(`keeps mega.mjs under ${MAX_BUNDLE_MB}MB`, () => {
    const mb = statSync(bundle).size / (1024 * 1024);
    expect(mb).toBeLessThan(MAX_BUNDLE_MB);
  });

  // `mega gui` boots the bridge from the bundle. The release prepack step copies
  // the separate frontend asset; the bundle build itself emits only the bridge.
  it.skipIf(!hasBundle)("inlines the GUI bridge (startGuiBridge in mega.mjs)", () => {
    const src = readFileSync(bundle, "utf8");
    expect(src).toContain("startGuiBridge");
  });

  it.skipIf(!hasPublishedGui)("ships the built GUI at dist-bundle/gui/index.html", () => {
    const indexHtml = join(bundleDir, "gui", "index.html");
    expect(existsSync(indexHtml)).toBe(true);
    expect(readFileSync(indexHtml, "utf8")).toContain('<div id="root">');
  });
});

describe("task kickoff runtime cancellation", () => {
  it("accepts incomplete preparation when fake Git never starts", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "megasaver-runtime-no-start-"));
    const runtime = join(fixtureRoot, "no-start.mjs");
    try {
      writeFileSync(runtime, "process.exitCode = 0;\n");
      await assertDelayedGitIsCancelled(runtime);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "requires fake Git to start in strong cancellation evidence mode",
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), "megasaver-runtime-strong-no-start-"));
      const runtime = join(fixtureRoot, "no-start.mjs");
      try {
        writeFileSync(runtime, "process.exitCode = 0;\n");
        await expect(assertDelayedGitIsCancelled(runtime, "strong")).rejects.toThrow(
          "strong cancellation evidence requires fake Git to start",
        );
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a runtime that lets delayed Git survive in strong mode",
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), "megasaver-runtime-uncancelled-"));
      const runtime = join(fixtureRoot, "uncancelled.mjs");
      try {
        writeFileSync(
          runtime,
          [
            'import { writeFileSync } from "node:fs";',
            'import { spawn } from "node:child_process";',
            'writeFileSync(process.env.MEGASAVER_GIT_STARTED_MARKER, "started");',
            'spawn(process.execPath, ["-e", "setTimeout(() => require(\'node:fs\').writeFileSync(process.env.MEGASAVER_GIT_LATE_MARKER, \'survived\'), 750)"], { detached: true, env: process.env, stdio: "ignore" }).unref();',
          ].join("\n"),
        );
        await expect(assertDelayedGitIsCancelled(runtime, "strong")).rejects.toThrow(
          "fake Git survived cancellation",
        );
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it.skipIf(!hasDistCli)(
    "cancels delayed git before the dist CLI terminates its worker",
    () => assertDelayedGitIsCancelled(distCli),
    20_000,
  );
});
