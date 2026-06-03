import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// R1 guard: the unbundled CLI must derive its version from package.json ONLY.
// A stray MEGA_CLI_VERSION env var must never influence the displayed version.
// The standalone bundle pins the version via an esbuild `define` literal
// (__MEGA_CLI_VERSION__) that does not exist in this source build, so importing
// main.ts here exercises exactly the unbundled code path: the define is absent,
// the package.json branch runs, and process.env is never consulted.

const require = createRequire(import.meta.url);
const { version: packageVersion } = require("../package.json") as { version: string };

function resolveMetaVersion(meta: unknown): string | undefined {
  const resolved = typeof meta === "function" ? (meta as () => { version?: string })() : meta;
  return (resolved as { version?: string }).version;
}

describe("@megasaver/cli version source (R1)", () => {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const original = process.env["MEGA_CLI_VERSION"];

  afterEach(() => {
    if (original === undefined) {
      // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      delete process.env["MEGA_CLI_VERSION"];
    } else {
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      process.env["MEGA_CLI_VERSION"] = original;
    }
  });

  it("ignores a stray MEGA_CLI_VERSION env var and uses package.json", async () => {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGA_CLI_VERSION"] = "9.9.9-stray";
    const { mainCommand } = await import("../src/main.js");
    expect(resolveMetaVersion(mainCommand.meta)).toBe(packageVersion);
    expect(resolveMetaVersion(mainCommand.meta)).not.toBe("9.9.9-stray");
  });

  it("does not read process.env in main.ts (env never honored)", () => {
    const mainSource = readFileSync(
      fileURLToPath(new URL("../src/main.ts", import.meta.url)),
      "utf8",
    );
    expect(mainSource).not.toMatch(/process\.env/);
  });
});
