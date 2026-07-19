import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeSpawnedSaver, prepareSaverStore } from "../src/saver-subprocess.js";

// Built by `pnpm turbo build --filter=@megasaver/cli...` then
// `pnpm --filter @megasaver/cli run bundle` (see apps/cli/package.json's
// `prepack` script). Not part of `pnpm verify` — skip cleanly if absent instead
// of faking the result.
const MEGA_BIN = resolve(import.meta.dirname, "../../../apps/cli/dist-bundle/mega.mjs");
const bundleExists = existsSync(MEGA_BIN);

// Mirrors apps/cli/src/store.ts resolveStorePath's macOS/Linux branch: XDG_DATA_HOME
// wins if set, else `<HOME>/.local/share/megasaver`. This is the real store a
// non-isolated hook invocation would write into — used here only to prove it did
// NOT happen, never written to by this test.
function realStoreRoot(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) return resolve(xdg, "megasaver");
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return resolve(home, ".local", "share", "megasaver");
}

type Heartbeats = { workspaces: Record<string, string> };

function readWorkspaceKeys(path: string): string[] {
  if (!existsSync(path)) return [];
  return Object.keys((JSON.parse(readFileSync(path, "utf8")) as Heartbeats).workspaces);
}

describe("makeSpawnedSaver store isolation (real binary)", () => {
  it.skipIf(!bundleExists)(
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
  it.skipIf(!bundleExists)("a seeded isolated store actually compresses", () => {
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
      // Clears safe mode's 32000-byte Read floor with the smallest margin that
      // still compresses: the real hook's cost grows super-linearly in payload
      // size (~5s at 40 KB, ~27s at 100 KB on the reviewing machine), and this
      // test must not sit against vitest's 30s ceiling.
      const raw = "x".repeat(40_000);
      const out = apply(raw, {
        toolUseId: "t1",
        toolName: "Read",
        toolInput: { file_path: join(cwd, "big.ts") },
      });
      expect(out).not.toBeNull();
      expect((out as string).length).toBeLessThan(raw.length);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it.skipIf(!bundleExists)("refuses to run against a store it could not enable", () => {
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

  if (!bundleExists) {
    it("SKIPPED: apps/cli/dist-bundle/mega.mjs not built — run `pnpm turbo build --filter=@megasaver/cli...` then `pnpm --filter @megasaver/cli run bundle` to enable this test", () => {
      expect(bundleExists).toBe(false);
    });
  }
});
