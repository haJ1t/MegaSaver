import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeSpawnedSaver } from "../src/saver-subprocess.js";

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

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
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
      const before = readIfExists(realHeartbeats);

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
        expect(existsSync(isolatedHeartbeats)).toBe(true);
        const isolated = JSON.parse(readFileSync(isolatedHeartbeats, "utf8")) as {
          workspaces: Record<string, string>;
        };
        expect(Object.keys(isolated.workspaces).length).toBeGreaterThan(0);

        // The real store must be byte-identical to before: nothing leaked out of
        // the isolated storeRoot into the operator's actual ~/.local/share/megasaver.
        expect(readIfExists(realHeartbeats)).toBe(before);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  if (!bundleExists) {
    it("SKIPPED: apps/cli/dist-bundle/mega.mjs not built — run `pnpm turbo build --filter=@megasaver/cli...` then `pnpm --filter @megasaver/cli run bundle` to enable this test", () => {
      expect(bundleExists).toBe(false);
    });
  }
});
