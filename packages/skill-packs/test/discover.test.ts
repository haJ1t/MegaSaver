import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverPacks } from "../src/discover.js";

function manifest(name: string, skillId = "hello"): string {
  return JSON.stringify({
    name,
    version: "1.0.0",
    kind: "skill",
    skills: [{ id: skillId, entry: "skills/hello.md" }],
    capabilities: [],
    description: null,
  });
}

async function seedPack(installRoot: string, name: string, skillId = "hello"): Promise<void> {
  const dir = join(installRoot, name);
  await mkdir(join(dir, "skills"), { recursive: true });
  await writeFile(join(dir, "megasaver-pack.json"), manifest(name, skillId));
  await writeFile(join(dir, "skills", "hello.md"), "# hello\n");
}

describe("discoverPacks", () => {
  let workspace: string;
  let xdg: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "sp-ws-"));
    xdg = await mkdtemp(join(tmpdir(), "sp-xdg-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(xdg, { recursive: true, force: true });
  });

  const wsPacks = () => join(workspace, ".megasaver", "packs");
  const globalPacks = () => join(xdg, "megasaver", "packs");

  function discover() {
    return discoverPacks({ workspaceRoot: workspace, home: "/nonexistent-home", xdgDataHome: xdg });
  }

  it("finds workspace and global packs with source labels", async () => {
    await seedPack(wsPacks(), "ws-pack");
    await seedPack(globalPacks(), "global-pack", "other");
    const result = await discover();
    expect(result.packs.map((p) => [p.manifest.name, p.source])).toEqual([
      ["ws-pack", "workspace"],
      ["global-pack", "global"],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("workspace wins on name collision (global shadowed, no warning)", async () => {
    await seedPack(wsPacks(), "dup");
    await seedPack(globalPacks(), "dup", "other");
    const result = await discover();
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]?.source).toBe("workspace");
  });

  it("skips a corrupt pack with a warning; siblings still load", async () => {
    await seedPack(wsPacks(), "good");
    await mkdir(join(wsPacks(), "broken"), { recursive: true });
    await writeFile(join(wsPacks(), "broken", "megasaver-pack.json"), "{nope");
    const result = await discover();
    expect(result.packs.map((p) => p.manifest.name)).toEqual(["good"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("broken");
  });

  it("missing roots → empty result, no warnings", async () => {
    const result = await discover();
    expect(result).toEqual({ packs: [], warnings: [] });
  });

  it("ignores .tmp-* staging dirs", async () => {
    await seedPack(wsPacks(), "real-pack");
    await seedPack(wsPacks(), ".tmp-real-pack");
    const result = await discover();
    expect(result.packs.map((p) => p.manifest.name)).toEqual(["real-pack"]);
  });

  it("falls back to <home>/.local/share when xdgDataHome is undefined", async () => {
    const home = await mkdtemp(join(tmpdir(), "sp-home-"));
    try {
      await seedPack(join(home, ".local", "share", "megasaver", "packs"), "home-pack");
      const result = await discoverPacks({
        workspaceRoot: workspace,
        home,
        xdgDataHome: undefined,
      });
      expect(result.packs.map((p) => p.manifest.name)).toEqual(["home-pack"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
