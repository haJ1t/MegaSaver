import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillPackError } from "./errors.js";
import { type InstallPackInput, type InstalledPack, installPack } from "./install.js";
import { loadPack } from "./load-pack.js";
import type { SkillPackManifest } from "./manifest.js";

export function getCuratedPacksDir(): string {
  // Resolve relative to this file or package root
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate1 = join(here, "..", "packs");
  if (existsSync(candidate1)) return candidate1;
  const candidate2 = join(here, "packs");
  if (existsSync(candidate2)) return candidate2;
  return candidate1;
}

export async function listCuratedPacks(): Promise<SkillPackManifest[]> {
  const dir = getCuratedPacksDir();
  if (!existsSync(dir)) return [];
  const packs: SkillPackManifest[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      try {
        const manifest = await loadPack(join(dir, entry.name));
        packs.push(manifest);
      } catch {}
    }
  }
  return packs;
}

export async function installCuratedPack(
  name: string,
  input: Omit<InstallPackInput, "sourceDir">,
): Promise<InstalledPack> {
  const dir = getCuratedPacksDir();
  const packDir = join(dir, name);
  if (!existsSync(packDir)) {
    throw new SkillPackError("pack_not_found", `curated pack "${name}" not found in ${dir}`);
  }
  return installPack({ ...input, sourceDir: packDir });
}
