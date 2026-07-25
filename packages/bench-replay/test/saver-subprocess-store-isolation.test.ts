import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeSpawnedSaver, prepareSaverStore } from "../src/saver-subprocess.js";

// The build-graph output, NOT the hand-built publish bundle (dist-bundle/mega.mjs
// is gitignored and only ever built by hand or by `prepack`, so it can be
// arbitrarily older than the source under test — a measurement harness proving
// itself against a stale binary is the drift this package exists to prevent).
// turbo/tsup rebuild dist/cli.js whenever the CLI or a dep changes, and CI builds
// before it verifies, so freshness needs no bespoke staleness check.
const MEGA_BIN = resolve(import.meta.dirname, "../../../apps/cli/dist/cli.js");
const canSpawnMega = existsSync(MEGA_BIN);

// Mirrors apps/cli/src/store.ts resolveStorePath's no-flag path on EVERY platform:
// XDG_DATA_HOME first, then the win32 LOCALAPPDATA branch, else
// `<HOME>/.local/share/megasaver`. This is the real store a non-isolated hook
// invocation would write into — used here only to prove it did NOT happen, never
// written to by this test. The win32 branch is not cosmetic: computing the POSIX
// path on Windows would name a directory that never exists, and the "real store
// untouched" assertion below would hold for free.
function realStoreRoot(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) return resolve(xdg, "megasaver");
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData && localAppData.length > 0) return resolve(localAppData, "megasaver");
    return resolve(home, "AppData", "Local", "megasaver");
  }
  return resolve(home, ".local", "share", "megasaver");
}

type Heartbeats = { workspaces: Record<string, string> };

function readWorkspaceKeys(path: string): string[] {
  if (!existsSync(path)) return [];
  return Object.keys((JSON.parse(readFileSync(path, "utf8")) as Heartbeats).workspaces);
}

describe("makeSpawnedSaver store isolation (real binary)", () => {
  it.skipIf(!canSpawnMega)(
    "writes the hook's store under the caller-supplied storeRoot, not the real store",
    () => {
      const base = mkdtempSync(join(tmpdir(), "bench-store-isolation-"));
      const cwd = join(base, "cwd");
      const storeRoot = join(base, "store");
      mkdirSync(cwd, { recursive: true }); // execFileSync's cwd option needs a real dir; storeRoot is left absent on purpose.
      const realHeartbeats = join(realStoreRoot(), "stats", "saver-hook-heartbeats.json");

      try {
        const apply = makeSpawnedSaver({
          megaBin: MEGA_BIN,
          cwd,
          sessionId: randomUUID(),
          storeRoot,
        });
        // Below every compression floor and the workspace is unregistered, so this
        // is a passthrough decision (null) — the point here is the STORE WRITE the
        // hook makes on every valid payload (the invocation heartbeat), not
        // compression, which store isolation must land in `storeRoot`.
        const result = apply("integration test raw tool output", {
          toolUseId: "t1",
          toolName: "Bash",
          toolInput: { command: "echo hi" },
        });
        expect(result).toBeNull();

        const isolatedHeartbeats = join(
          storeRoot,
          "megasaver",
          "stats",
          "saver-hook-heartbeats.json",
        );
        const isolatedKeys = readWorkspaceKeys(isolatedHeartbeats);
        expect(isolatedKeys.length).toBeGreaterThan(0);

        // Isolation evidence, stated precisely: THIS test's temp cwd registered a
        // workspace in the isolated store and in no circumstance in the real one.
        // Byte-comparing the whole real heartbeat file would be flakier and
        // weaker — any concurrent Claude Code session (including the one running
        // `pnpm verify` in this dogfooding repo) mutates it through its own
        // PostToolUse hook, failing the test for a leak that never happened.
        const realKeys = readWorkspaceKeys(realHeartbeats);
        for (const key of isolatedKeys) expect(realKeys).not.toContain(key);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  // Fix 2: a FRESH isolated store has no saver settings, so the hook resolves to
  // "disabled (safe) — source missing" and passes everything through. The whole
  // measured effect silently depended on a seeding step that lived nowhere in
  // this package. This is the test that would have caught it.
  it.skipIf(!canSpawnMega)(
    "a seeded isolated store actually compresses",
    () => {
      const base = mkdtempSync(join(tmpdir(), "bench-store-seeded-"));
      const cwd = join(base, "cwd");
      const storeRoot = join(base, "store");
      mkdirSync(cwd, { recursive: true });

      try {
        prepareSaverStore({ megaBin: MEGA_BIN, cwd, storeRoot, mode: "safe" });
        const apply = makeSpawnedSaver({
          megaBin: MEGA_BIN,
          cwd,
          sessionId: randomUUID(),
          storeRoot,
        });
        // Clears safe mode's 32000-byte Read floor. The real hook's cost grows
        // super-linearly in payload size, so the margin is kept small — but not
        // minimal, and the timeout below is what actually has to absorb it.
        const raw = "x".repeat(40_000);
        const out = apply(raw, {
          toolUseId: "t1",
          toolName: "Read",
          toolInput: { file_path: join(cwd, "big.ts") },
        });
        expect(out).not.toBeNull();
        expect((out as string).length).toBeLessThan(raw.length);

        // Stage A: the saver compresses a given output only on FIRST SIGHT, and the
        // seen-ledger it consults lives in the store — so replaying the identical
        // payload in the same session must pass through. Pins the binary under test
        // to a build that actually has the subsystem the harness claims to isolate.
        const second = apply(raw, {
          toolUseId: "t2",
          toolName: "Read",
          toolInput: { file_path: join(cwd, "big.ts") },
        });
        expect(second).toBeNull();
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
    // Two real hook spawns over a 40 KB payload: measured 27s standalone on a
    // fast dev machine, and windows-latest runners are routinely 2-3x slower at
    // process spawn plus filesystem work. vitest's 30s default is far too tight,
    // and 60s was under a 2.2x margin — this test is newly un-skipped on the one
    // platform this change exists to turn green, so a timeout here would
    // reproduce the red job with a different cause.
    120_000,
  );

  it.skipIf(!canSpawnMega)("refuses to run against a store it could not enable", () => {
    const base = mkdtempSync(join(tmpdir(), "bench-store-unseeded-"));
    const cwd = join(base, "cwd");
    mkdirSync(cwd, { recursive: true });
    try {
      expect(() =>
        prepareSaverStore({
          megaBin: join(base, "does-not-exist.mjs"),
          cwd,
          storeRoot: join(base, "store"),
          mode: "safe",
        }),
      ).toThrow(/saver/i);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  if (!canSpawnMega) {
    it("SKIPPED: cannot spawn apps/cli/dist/cli.js — run `pnpm turbo build --filter=@megasaver/cli...` to enable this test", () => {
      expect(canSpawnMega).toBe(false);
    });
  }
});
