import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanRepo } from "../src/scan.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-scan-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "app.ts"), "export const a = 1;\n");
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dep", "index.ts"), "export const x = 1;\n");
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", "out.ts"), "export const o = 1;\n");
  writeFileSync(join(root, ".gitignore"), "build/\n*.log\n");
  mkdirSync(join(root, "build"));
  writeFileSync(join(root, "build", "gen.ts"), "export const g = 1;\n");
  writeFileSync(join(root, "debug.log"), "noisy\n");
  writeFileSync(join(root, ".megaignore"), "notes-secret.md\n");
  writeFileSync(join(root, "notes-secret.md"), "# secret notes\n");
  writeFileSync(join(root, ".env"), "API_KEY=abc123\n");
  writeFileSync(join(root, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
  writeFileSync(join(root, "big.ts"), `export const big = "${"x".repeat(400)}";\n`);
  // symlink pointing OUTSIDE the root
  symlinkSync(tmpdir(), join(root, "escape-link"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scanRepo", () => {
  it("includes real source and excludes ignored/secret/binary/large/symlink", () => {
    const result = scanRepo({ rootDir: root, maxFileSize: 100 });
    const included = result.files.map((f) => f.path);

    expect(included).toContain("src/app.ts");
    for (const excluded of [
      "node_modules/dep/index.ts",
      "dist/out.ts",
      "build/gen.ts",
      "debug.log",
      "notes-secret.md",
      ".env",
      "bin.dat",
      "big.ts",
      "escape-link",
    ]) {
      expect(included).not.toContain(excluded);
    }
  });

  it("records skip reasons for secret, binary, and oversized files", () => {
    const result = scanRepo({ rootDir: root, maxFileSize: 100 });
    const reasonOf = (p: string) => result.skipped.find((s) => s.path === p)?.reason;
    expect(reasonOf(".env")).toBe("secret");
    expect(reasonOf("bin.dat")).toBe("binary");
    expect(reasonOf("big.ts")).toBe("too-large");
  });

  it("tags language and POSIX-normalized path for included files", () => {
    const result = scanRepo({ rootDir: root, maxFileSize: 100 });
    const app = result.files.find((f) => f.path === "src/app.ts");
    expect(app?.language).toBe("typescript");
    expect(app?.path.includes("\\")).toBe(false);
    expect((app?.size ?? 0) > 0).toBe(true);
  });
});
