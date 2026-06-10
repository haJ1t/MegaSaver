import { type Dirent, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SkillPackError } from "./errors.js";
import { loadPack } from "./load-pack.js";
import type { SkillPackManifest } from "./manifest.js";

export type DiscoverInput = {
  workspaceRoot: string;
  home: string;
  xdgDataHome: string | undefined;
};

export type DiscoveredPack = {
  manifest: SkillPackManifest;
  root: string;
  source: "workspace" | "global";
};

export type DiscoveryResult = {
  packs: DiscoveredPack[];
  warnings: string[];
};

export function workspacePacksRoot(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".megasaver", "packs");
}

export function globalPacksRoot(home: string, xdgDataHome: string | undefined): string {
  const base =
    xdgDataHome && xdgDataHome.length > 0 ? resolve(xdgDataHome) : resolve(home, ".local", "share");
  return join(base, "megasaver", "packs");
}

function listCandidateDirs(root: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // missing root: empty scan, no warning (spec §2b)
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".tmp-"))
    .map((e) => join(root, e.name));
}

export async function discoverPacks(input: DiscoverInput): Promise<DiscoveryResult> {
  const roots: Array<{ dir: string; source: "workspace" | "global" }> = [
    { dir: workspacePacksRoot(input.workspaceRoot), source: "workspace" },
    { dir: globalPacksRoot(input.home, input.xdgDataHome), source: "global" },
  ];

  const packs: DiscoveredPack[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const { dir, source } of roots) {
    for (const candidate of listCandidateDirs(dir)) {
      let manifest: SkillPackManifest;
      try {
        manifest = await loadPack(candidate);
      } catch (err) {
        const detail = err instanceof SkillPackError ? `${err.code}: ${err.message}` : String(err);
        warnings.push(`${candidate}: ${detail}`);
        continue;
      }
      if (seen.has(manifest.name)) continue; // workspace beats global (HH §4)
      seen.add(manifest.name);
      packs.push({ manifest, root: candidate, source });
    }
  }
  return { packs, warnings };
}
