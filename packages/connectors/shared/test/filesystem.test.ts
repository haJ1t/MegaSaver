import { chmod, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorError } from "../src/errors.js";
import {
  assertProjectRoot,
  readTargetFile,
  syncTargetBlock,
  writeTargetFile,
} from "../src/filesystem.js";
import { buildContext } from "./fixtures.js";

describe("filesystem helpers", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-shared-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("readTargetFile returns null when file is missing", async () => {
    expect(await readTargetFile(join(root, "missing.md"))).toBeNull();
  });

  it("writeTargetFile then readTargetFile round-trip", async () => {
    const path = join(root, "AGENTS.md");
    await writeTargetFile({ absPath: path, content: "hello\n" });
    expect(await readTargetFile(path)).toBe("hello\n");
  });

  it("syncTargetBlock creates the file with the rendered block", async () => {
    const path = join(root, "AGENTS.md");
    await syncTargetBlock({ absPath: path, context: buildContext() });
    const written = await readFile(path, "utf8");
    expect(written).toContain("<!-- MEGA SAVER:BEGIN -->");
  });

  it("syncTargetBlock preserves user content above the block", async () => {
    const path = join(root, "AGENTS.md");
    await writeTargetFile({ absPath: path, content: "# user\n\n" });
    await syncTargetBlock({ absPath: path, context: buildContext() });
    const written = await readFile(path, "utf8");
    expect(written.startsWith("# user\n\n<!--")).toBe(true);
  });

  it("writeTargetFile surfaces ENOTDIR/EACCES as file_write_failed", async () => {
    const bogus = join(root, "does", "not", "exist", "AGENTS.md");
    await expect(writeTargetFile({ absPath: bogus, content: "x" })).rejects.toBeInstanceOf(
      ConnectorError,
    );
  });

  it("writeTargetFile refuses to replace a symlink", async () => {
    const real = join(root, "real.md");
    const link = join(root, "AGENTS.md");
    await writeTargetFile({ absPath: real, content: "real\n" });
    await symlink(real, link);
    const err = await writeTargetFile({ absPath: link, content: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe("file_write_failed");
  });

  it("writeTargetFile preserves existing file mode", async () => {
    const path = join(root, "AGENTS.md");
    await writeTargetFile({ absPath: path, content: "v1\n" });
    await chmod(path, 0o600);
    await writeTargetFile({ absPath: path, content: "v2\n" });
    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("assertProjectRoot rejects relative paths with target_path_invalid", async () => {
    const err = await assertProjectRoot("relative/path").catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe("target_path_invalid");
  });

  it("assertProjectRoot rejects non-directory targets with target_path_invalid", async () => {
    const filePath = join(root, "file.txt");
    await writeTargetFile({ absPath: filePath, content: "x" });
    const err = await assertProjectRoot(filePath).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe("target_path_invalid");
  });

  it("assertProjectRoot accepts an existing absolute directory", async () => {
    await expect(assertProjectRoot(root)).resolves.toBeUndefined();
  });

  // S5: read-path symlink semantics.
  // readTargetFile uses readFile which follows symlinks (no lstat-first check).
  // Current behavior: reads through symlinks, even ones pointing outside the
  // project root. This is documented here so any future lstat-first guard that
  // would break this test is noticed explicitly.
  //
  // SECURITY NOTE: The write path (writeTargetFile) already guards against
  // symlinks with an lstat check + isSymbolicLink() rejection. The read path
  // does NOT guard — it reads through. This asymmetry is acceptable for v0.1
  // (read-only risk is lower than write risk), but a future hardening pass
  // should consider adding lstat-first to readTargetFile as well.
  it("S5: readTargetFile reads through a symlink pointing outside the project root", async () => {
    // Create a file "outside" the project root (in a sibling temp dir).
    const outsideRoot = await mkdtemp(join(tmpdir(), "megasaver-outside-"));
    try {
      const outsideFile = join(outsideRoot, "external.md");
      await writeTargetFile({ absPath: outsideFile, content: "external content\n" });

      // Create a symlink inside root that points to the outside file.
      const symlinkInRoot = join(root, "CLAUDE.md");
      await symlink(outsideFile, symlinkInRoot);

      // readTargetFile follows the symlink and returns the external content.
      const result = await readTargetFile(symlinkInRoot);
      expect(result).toBe("external content\n");
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
