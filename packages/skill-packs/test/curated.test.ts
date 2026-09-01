import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installCuratedPack, listCuratedPacks } from "../src/curated.js";
import { discoverPacks } from "../src/discover.js";

let tmpWorkspace: string;
let tmpHome: string;

afterEach(() => {
  if (tmpWorkspace) rmSync(tmpWorkspace, { recursive: true, force: true });
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

describe("Curated Skill Packs", () => {
  it("lists all bundled curated skill packs", async () => {
    const packs = await listCuratedPacks();
    expect(packs.length).toBeGreaterThanOrEqual(3);
    const names = packs.map((p) => p.name);
    expect(names).toContain("context-discipline");
    expect(names).toContain("evidence-preservation");
    expect(names).toContain("output-compression");
  });

  it("installs a curated pack to workspace root and discovers it", async () => {
    tmpWorkspace = mkdtempSync(join(tmpdir(), "sp-ws-"));
    tmpHome = mkdtempSync(join(tmpdir(), "sp-home-"));

    const installed = await installCuratedPack("context-discipline", {
      workspaceRoot: tmpWorkspace,
      home: tmpHome,
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      force: false,
    });

    expect(installed.manifest.name).toBe("context-discipline");
    expect(installed.manifest.version).toBe("1.2.0");

    const discovered = await discoverPacks({
      workspaceRoot: tmpWorkspace,
      home: tmpHome,
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
    });

    expect(discovered.packs.some((p) => p.manifest.name === "context-discipline")).toBe(true);
  });
});
