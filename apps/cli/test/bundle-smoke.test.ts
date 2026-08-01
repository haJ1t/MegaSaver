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
const taskKickoffWorkerBundle = join(bundleDir, "task-kickoff-worker.mjs");
const hasBundle = existsSync(bundle);

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
      expect(JSON.parse(out)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
        },
      });
      expect(
        readTaskKickoffEvents({ root: storeRoot }, encodeWorkspaceKey(projectRoot)),
      ).toHaveLength(1);
      expect(
        readSessionIntent(storeRoot, encodeWorkspaceKey(projectRoot), "bundle-smoke", Date.now),
      ).toBe("repair auth");
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

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

  // `mega gui` boots the bridge from the bundle and serves the copied dist.
  // Both must ship: the bridge inlined into mega.mjs (startGuiBridge symbol) and
  // the frontend copied to dist-bundle/gui by the prepack copy step.
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
