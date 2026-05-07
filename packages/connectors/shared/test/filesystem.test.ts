import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorError } from "../src/errors.js";
import { readTargetFile, syncTargetBlock, writeTargetFile } from "../src/filesystem.js";
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
});
