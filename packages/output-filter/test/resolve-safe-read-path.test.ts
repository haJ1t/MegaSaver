import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OutputFilterError } from "../src/errors.js";
import { resolveSafeReadPath } from "../src/resolve-safe-read-path.js";
import { describeUnlessWindows } from "./_platform.js";

let projectRoot: string;
let outsideDir: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "ofp-root-"));
  outsideDir = mkdtempSync(join(tmpdir(), "ofp-out-"));

  writeFileSync(join(projectRoot, "inside.txt"), "ok");
  mkdirSync(join(projectRoot, "sub"), { recursive: true });
  writeFileSync(join(projectRoot, "sub", "nested.txt"), "ok");

  writeFileSync(join(outsideDir, "secret.txt"), "leak");
});

afterAll(() => {
  // best-effort cleanup; temp dirs are fine to leave on failure
});

describe("resolveSafeReadPath (spec §5.2 / §8a)", () => {
  it("accepts an in-sandbox relative path", () => {
    const { absolute } = resolveSafeReadPath({ path: "inside.txt", projectRoot });
    expect(absolute).toBe(join(projectRoot, "inside.txt"));
  });

  it("accepts an in-sandbox absolute path", () => {
    const target = join(projectRoot, "sub", "nested.txt");
    const { absolute } = resolveSafeReadPath({ path: target, projectRoot });
    expect(absolute).toBe(target);
  });

  it("rejects ..-traversal escaping all allowed roots", () => {
    expect(() =>
      resolveSafeReadPath({ path: "../../../../../../etc/passwd", projectRoot }),
    ).toThrow(OutputFilterError);
  });

  it("rejects an absolute path outside {projectRoot, cwd, HOME}", () => {
    try {
      resolveSafeReadPath({ path: join(outsideDir, "secret.txt"), projectRoot });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputFilterError);
      expect((err as OutputFilterError).code).toBe("path_unsafe");
    }
  });

  it("accepts a non-existent in-sandbox target via nearest existing ancestor", () => {
    expect(() =>
      resolveSafeReadPath({ path: join(projectRoot, "sub", "does-not-exist.txt"), projectRoot }),
    ).not.toThrow();
  });

  // Symlink creation needs elevation on Windows (EPERM); the symlink fixtures
  // live in their own beforeAll so the EPERM cannot fail the whole file —
  // only this block skips on Windows, the 5 tests above still run there.
  describeUnlessWindows("symlink realpath checks (POSIX-only)", () => {
    beforeAll(() => {
      // symlink inside the root that points OUTSIDE the sandbox
      symlinkSync(join(outsideDir, "secret.txt"), join(projectRoot, "escape-link"));
      // symlink inside the root that points INSIDE the sandbox
      symlinkSync(join(projectRoot, "inside.txt"), join(projectRoot, "inside-link"));
    });

    it("rejects a symlink whose realpath escapes the sandbox", () => {
      expect(() => resolveSafeReadPath({ path: "escape-link", projectRoot })).toThrow(
        OutputFilterError,
      );
    });

    it("accepts a symlink that stays inside the sandbox", () => {
      expect(() => resolveSafeReadPath({ path: "inside-link", projectRoot })).not.toThrow();
    });
  });
});
