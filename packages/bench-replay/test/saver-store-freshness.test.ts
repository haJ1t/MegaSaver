import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareSaverStore } from "../src/saver-subprocess.js";

// Fresh-store-per-run hygiene: the script bin answers the two prepare calls.
function writeScriptBin(root: string): string {
  const path = join(root, "mega.cjs");
  writeFileSync(
    path,
    `const argv = process.argv.slice(2).join(" ");
if (argv.startsWith("session saver default enable")) process.stdout.write('{"ok":true}\\n');
else if (argv.startsWith("session saver resolve")) process.stdout.write('{"enabled":true,"mode":"balanced"}\\n');
else process.exit(2);
`,
    { mode: 0o644 },
  );
  return path;
}

let root: string;
let megaBin: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-fresh-store-"));
  cwd = join(root, "cwd");
  mkdirSync(cwd, { recursive: true });
  megaBin = writeScriptBin(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prepareSaverStore — fresh store per run", () => {
  it("accepts a fresh store", () => {
    expect(() =>
      prepareSaverStore({ megaBin, cwd, storeRoot: join(root, "store"), mode: "balanced" }),
    ).not.toThrow();
  });

  it("refuses a store that already carries workspace-scoped stats records", () => {
    const storeRoot = join(root, "used-store");
    mkdirSync(join(storeRoot, "megasaver", "stats", "0123456789abcdef"), { recursive: true });
    writeFileSync(join(storeRoot, "megasaver", "stats", "0123456789abcdef", "net-effect.json"), "{}");
    expect(() =>
      prepareSaverStore({ megaBin, cwd, storeRoot, mode: "balanced" }),
    ).toThrow(/fresh/);
  });

  it("refuses a store that already carries content/ chunks", () => {
    const storeRoot = join(root, "used-store-2");
    mkdirSync(join(storeRoot, "megasaver", "content", "0123456789abcdef"), { recursive: true });
    expect(() =>
      prepareSaverStore({ megaBin, cwd, storeRoot, mode: "balanced" }),
    ).toThrow(/fresh/);
  });

  it("refuses even a store whose only artifact is a prior run's activation record", () => {
    const storeRoot = join(root, "used-store-3");
    mkdirSync(join(storeRoot, "megasaver", "stats"), { recursive: true });
    writeFileSync(join(storeRoot, "megasaver", "stats", "workspace-token-saver-default.json"), "{}");
    expect(() =>
      prepareSaverStore({ megaBin, cwd, storeRoot, mode: "balanced" }),
    ).toThrow(/fresh/);
  });
});
