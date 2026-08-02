import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "@megasaver/indexer";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { readTaskKickoffEvents } from "@megasaver/stats";
import { describe, expect, it } from "vitest";
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

type RuntimeCancellationEvidenceMode = "normal" | "strong";

function assertTaskKickoffBundleResult(
  platform: NodeJS.Platform,
  out: string,
  events: readonly unknown[],
): void {
  if (platform === "win32") {
    expect(out).toBe("");
    expect(events).toEqual([]);
    return;
  }
  expect(JSON.parse(out)).toMatchObject({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
    },
  });
  expect(events).toHaveLength(1);
}

async function assertDelayedGitIsCancelled(
  runtime: string,
  evidenceMode: RuntimeCancellationEvidenceMode = process.env[STRONG_RUNTIME_CANCEL_ENV] === "1"
    ? "strong"
    : "normal",
): Promise<void> {
  const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-runtime-cancel-store-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "megasaver-runtime-cancel-project-"));
  const fakeBin = mkdtempSync(join(tmpdir(), "megasaver-runtime-cancel-bin-"));
  const startedMarker = join(fakeBin, "git-started");
  const lateMarker = join(fakeBin, "git-survived");
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
        'printf started > "$MEGASAVER_GIT_STARTED_MARKER"',
        "sleep 0.75",
        'printf survived > "$MEGASAVER_GIT_LATE_MARKER"',
        "while true; do sleep 1; done",
      ].join("\n"),
      { mode: 0o700 },
    );

    const out = execFileSync(process.execPath, [runtime, "hooks", "intent", "--store", storeRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        // biome-ignore lint/complexity/useLiteralKeys: PATH is the executable lookup boundary.
        PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
        MEGASAVER_GIT_STARTED_MARKER: startedMarker,
        MEGASAVER_GIT_LATE_MARKER: lateMarker,
      },
      input: JSON.stringify({
        prompt: "repair auth",
        cwd: projectRoot,
        session_id: "runtime-cancel-smoke",
      }),
      timeout: 5_000,
    });

    expect(out).toBe("");
    if (evidenceMode === "strong" && process.platform !== "win32" && !existsSync(startedMarker)) {
      throw new Error("strong cancellation evidence requires fake Git to start");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (existsSync(lateMarker)) {
      throw new Error("fake Git survived cancellation");
    }
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
}

describe("standalone CLI bundle", () => {
  it.skipIf(!hasBundle)(
    "runs `doctor` from the built mega.mjs (exit 0, no ESM-global crash)",
    () => {
      const out = execFileSync(process.execPath, [bundle, "doctor"], { encoding: "utf8" });
      expect(out).toContain("PASS");
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
      if (process.platform !== "win32") {
        expect(
          readSessionIntent(storeRoot, encodeWorkspaceKey(projectRoot), "bundle-smoke", Date.now),
        ).toBe("repair auth");
      }
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasBundle)(
    "cancels delayed Git in the single published bundle",
    () => assertDelayedGitIsCancelled(bundle),
    10_000,
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

  it.skipIf(!hasBundle)("ships the built GUI at dist-bundle/gui/index.html", () => {
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
    10_000,
  );

  it.skipIf(!hasDistCli)(
    "cancels delayed git before the dist CLI terminates its worker",
    () => assertDelayedGitIsCancelled(distCli),
    10_000,
  );
});
