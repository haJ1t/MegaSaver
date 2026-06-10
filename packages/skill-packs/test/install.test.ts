import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPack, removePack } from "../src/install.js";

const MANIFEST = {
  name: "demo-pack",
  version: "1.0.0",
  kind: "skill",
  skills: [{ id: "hello", entry: "skills/hello.md" }],
  capabilities: [],
  description: null,
};

async function seedSource(dir: string, manifest: unknown = MANIFEST): Promise<void> {
  await mkdir(join(dir, "skills"), { recursive: true });
  await writeFile(join(dir, "megasaver-pack.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "skills", "hello.md"), "# hello\n");
}

describe("installPack / removePack", () => {
  let workspace: string;
  let source: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "sp-install-ws-"));
    source = await mkdtemp(join(tmpdir(), "sp-install-src-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  });

  function install(opts: { force?: boolean } = {}) {
    return installPack({
      sourceDir: source,
      workspaceRoot: workspace,
      home: "/nonexistent-home",
      xdgDataHome: undefined,
      force: opts.force ?? false,
    });
  }

  const installedDir = () => join(workspace, ".megasaver", "packs", "demo-pack");

  it("installs a valid pack into <workspace>/.megasaver/packs/<name>", async () => {
    await seedSource(source);
    const installed = await install();
    expect(installed.manifest.name).toBe("demo-pack");
    const files = await readdir(installedDir());
    expect(files).toContain("megasaver-pack.json");
  });

  it("validates BEFORE copy: invalid pack leaves packs root untouched", async () => {
    await seedSource(source, { name: "Bad Name" });
    await expect(install()).rejects.toMatchObject({ code: "manifest_invalid" });
    await expect(readdir(join(workspace, ".megasaver", "packs"))).rejects.toThrow();
  });

  it("pack_already_installed on collision without force; force replaces", async () => {
    await seedSource(source);
    await install();
    await expect(install()).rejects.toMatchObject({ code: "pack_already_installed" });
    await writeFile(join(source, "skills", "hello.md"), "# v2\n");
    const replaced = await install({ force: true });
    expect(replaced.manifest.name).toBe("demo-pack");
  });

  it("skill_id_conflict against an installed pack with the same skill id", async () => {
    await seedSource(source);
    await install();
    const other = await mkdtemp(join(tmpdir(), "sp-install-src2-"));
    try {
      await seedSource(other, { ...MANIFEST, name: "other-pack" });
      await expect(
        installPack({
          sourceDir: other,
          workspaceRoot: workspace,
          home: "/nonexistent-home",
          xdgDataHome: undefined,
          force: false,
        }),
      ).rejects.toMatchObject({ code: "skill_id_conflict" });
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("force reinstall of the same pack does NOT self-conflict (shadow-aware)", async () => {
    await seedSource(source);
    await install();
    await expect(install({ force: true })).resolves.toBeTruthy();
  });

  it("rejects a symlink anywhere in the source tree", async () => {
    await seedSource(source);
    const outside = join(source, "..", `sp-outside-${process.pid}`);
    await writeFile(outside, "outside\n");
    try {
      await symlink(outside, join(source, "skills", "evil-link"));
      await expect(install()).rejects.toMatchObject({ code: "pack_path_escape" });
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("no .tmp-* residue after a failed install", async () => {
    await seedSource(source, { name: "Bad Name" });
    await install().catch(() => undefined);
    const packsRoot = join(workspace, ".megasaver", "packs");
    const entries = await readdir(packsRoot).catch(() => [] as string[]);
    expect(entries.filter((e) => e.startsWith(".tmp-"))).toEqual([]);
  });

  it("removePack rejects a traversal name before touching the filesystem", async () => {
    // Plant a victim OUTSIDE the packs root; a buggy join+rmSync would delete it.
    const victim = join(workspace, "victim.txt");
    await writeFile(victim, "do not delete\n");
    for (const name of ["../../victim", "..", "", "a/b"]) {
      await expect(removePack({ name, workspaceRoot: workspace })).rejects.toMatchObject({
        code: expect.stringMatching(/pack_not_found|manifest_invalid/),
      });
    }
    await expect(readdir(workspace)).resolves.toContain("victim.txt");
  });

  it("removePack removes an installed pack; pack_not_found for unknown", async () => {
    await seedSource(source);
    await install();
    await removePack({ name: "demo-pack", workspaceRoot: workspace });
    await expect(readdir(installedDir())).rejects.toThrow();
    await expect(removePack({ name: "demo-pack", workspaceRoot: workspace })).rejects.toMatchObject(
      { code: "pack_not_found" },
    );
  });
});
