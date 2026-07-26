import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { installClaudeCodeHook, uninstallClaudeCodeHook } from "../src/hook-settings.js";

// WHY: NTFS ignores POSIX chmod mode bits and symlink creation needs elevation
// on Windows, so these tests cannot run on the windows-latest CI matrix. The
// skip is explicit so it is never mistaken for coverage.
// Precedent: packages/stats/test/_platform.ts.
const describeUnlessWindows = process.platform === "win32" ? describe.skip : describe;

const SECRET = "sk-ant-REAL-SECRET-DO-NOT-LEAK";
const seeded = { env: { ANTHROPIC_API_KEY: SECRET, ANTHROPIC_AUTH_TOKEN: SECRET } };

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ms-hook-perms-"));
}

function seedSettings(mode: number): string {
  const p = join(tmpDir(), "settings.json");
  writeFileSync(p, `${JSON.stringify(seeded, null, 2)}\n`);
  chmodSync(p, mode);
  return p;
}

const modeOf = (p: string): string => (statSync(p).mode & 0o777).toString(8);

describeUnlessWindows("hook settings write preserves the operator's file mode", () => {
  // 0o660 is the umask-sensitive row: creating the temp file with that mode
  // under the default umask 022 yields 0640, so only an explicit chmod on the
  // temp inode preserves it exactly.
  // 0o644 is the don't-over-correct row: a security fix that silently NARROWS
  // the operator's chosen permissions is its own surprise.
  it.each([0o600, 0o640, 0o400, 0o660, 0o644])(
    "install preserves an existing mode of %s",
    (mode) => {
      const p = seedSettings(mode);
      installClaudeCodeHook({ settingsPath: p });
      expect(modeOf(p)).toBe(mode.toString(8));
      expect(readFileSync(p, "utf8")).toContain(SECRET);
    },
  );

  it("uninstall preserves an existing mode", () => {
    const p = seedSettings(0o600);
    installClaudeCodeHook({ settingsPath: p });
    chmodSync(p, 0o600);
    uninstallClaudeCodeHook({ settingsPath: p });
    expect(modeOf(p)).toBe("600");
  });

  it("creates a fresh settings file 0600", () => {
    const p = join(tmpDir(), "settings.json");
    installClaudeCodeHook({ settingsPath: p });
    expect(modeOf(p)).toBe("600");
  });

  it("refuses a symlinked settings path, leaving the link and its target intact", () => {
    const dir = tmpDir();
    const target = join(dir, "real-settings.json");
    const link = join(dir, "settings.json");
    const before = `${JSON.stringify(seeded, null, 2)}\n`;
    writeFileSync(target, before);
    symlinkSync(target, link);

    expect(() => installClaudeCodeHook({ settingsPath: link })).toThrow();
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  it("a failed write leaves the target's bytes and mode untouched and no temp residue", () => {
    const p = seedSettings(0o600);
    const dir = dirname(p);
    const before = readFileSync(p, "utf8");
    chmodSync(dir, 0o500);
    try {
      expect(() => installClaudeCodeHook({ settingsPath: p })).toThrow();
      expect(readFileSync(p, "utf8")).toBe(before);
      expect(modeOf(p)).toBe("600");
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });
});
