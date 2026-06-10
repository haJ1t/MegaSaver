import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPack } from "../src/load-pack.js";

const MANIFEST = {
  name: "demo-pack",
  version: "1.0.0",
  kind: "skill",
  skills: [{ id: "hello", entry: "skills/hello.md" }],
  capabilities: [],
  description: null,
};

async function seedPack(root: string, manifest: unknown = MANIFEST): Promise<void> {
  await mkdir(join(root, "skills"), { recursive: true });
  await writeFile(join(root, "megasaver-pack.json"), JSON.stringify(manifest));
  await writeFile(join(root, "skills", "hello.md"), "# hello\n");
}

describe("loadPack — real loader", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "skillpack-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads a valid pack and returns the parsed manifest", async () => {
    await seedPack(root);
    const manifest = await loadPack(root);
    expect(manifest.name).toBe("demo-pack");
    expect(manifest.skills).toHaveLength(1);
  });

  it("manifest_missing when megasaver-pack.json is absent", async () => {
    await expect(loadPack(root)).rejects.toMatchObject({ code: "manifest_missing" });
  });

  it("pack_unreadable on garbage JSON", async () => {
    await writeFile(join(root, "megasaver-pack.json"), "{not json");
    await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_unreadable" });
  });

  it("manifest_invalid on schema violation", async () => {
    await seedPack(root, { name: "Bad Name", version: "1.0.0" });
    await expect(loadPack(root)).rejects.toMatchObject({ code: "manifest_invalid" });
  });

  it("pack_path_escape on ../ entry", async () => {
    await seedPack(root, {
      ...MANIFEST,
      skills: [{ id: "hello", entry: "../outside.md" }],
    });
    await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_path_escape" });
  });

  it("pack_path_escape on absolute entry", async () => {
    await seedPack(root, {
      ...MANIFEST,
      skills: [{ id: "hello", entry: "/etc/passwd" }],
    });
    await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_path_escape" });
  });

  it("pack_path_escape on symlinked entry", async () => {
    await seedPack(root);
    const outside = join(root, "..", `outside-${process.pid}.md`);
    await writeFile(outside, "outside\n");
    await rm(join(root, "skills", "hello.md"));
    await symlink(outside, join(root, "skills", "hello.md"));
    try {
      await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_path_escape" });
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("pack_unreadable when an entry file is missing", async () => {
    await seedPack(root, {
      ...MANIFEST,
      skills: [{ id: "hello", entry: "skills/nope.md" }],
    });
    await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_unreadable" });
  });

  it("rejects an empty path at the boundary", async () => {
    await expect(loadPack("")).rejects.toThrow();
  });
});
