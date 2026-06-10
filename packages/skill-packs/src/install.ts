import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanSkillIdConflicts } from "./conflicts.js";
import { type DiscoveredPack, discoverPacks, workspacePacksRoot } from "./discover.js";
import { SkillPackError } from "./errors.js";
import { loadPack } from "./load-pack.js";

export type InstallPackInput = {
  sourceDir: string;
  workspaceRoot: string;
  home: string;
  xdgDataHome: string | undefined;
  force: boolean;
};

export type InstalledPack = {
  manifest: DiscoveredPack["manifest"];
  root: string;
};

function assertNoSymlinks(dir: string, packRoot: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (lstatSync(full).isSymbolicLink()) {
      throw new SkillPackError("pack_path_escape", `symlink in pack tree rejected: ${full}`, {
        packPath: packRoot,
      });
    }
    if (entry.isDirectory()) assertNoSymlinks(full, packRoot);
  }
}

export async function installPack(input: InstallPackInput): Promise<InstalledPack> {
  // 1. Validate BEFORE any copy (HH §5).
  const manifest = await loadPack(input.sourceDir);
  // 2. Symlink sweep over the whole source tree (spec §3a.2).
  assertNoSymlinks(input.sourceDir, input.sourceDir);

  // 3. Shadow-aware conflict scan: the incoming pack replaces/shadows
  //    any same-name pack, so drop those from the effective set first.
  const discovered = await discoverPacks({
    workspaceRoot: input.workspaceRoot,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
  });
  const effective = discovered.packs.filter((p) => p.manifest.name !== manifest.name);
  const conflicts = scanSkillIdConflicts([
    ...effective,
    { manifest, root: input.sourceDir, source: "workspace" },
  ]);
  if (conflicts.length > 0) {
    const first = conflicts[0];
    throw new SkillPackError(
      "skill_id_conflict",
      `skill id "${first?.skillId}" already provided by: ${first?.packs.join(", ")}`,
      { packPath: input.sourceDir },
    );
  }

  // 4. Collision check.
  const packsRoot = workspacePacksRoot(input.workspaceRoot);
  const target = join(packsRoot, manifest.name);
  if (existsSync(target) && !input.force) {
    throw new SkillPackError("pack_already_installed", `pack already installed: ${manifest.name}`, {
      packPath: target,
    });
  }

  // 5. Atomic copy: stage to .tmp-<name>, then swap (spec §3a.5).
  const staging = join(packsRoot, `.tmp-${manifest.name}`);
  mkdirSync(packsRoot, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  try {
    cpSync(input.sourceDir, staging, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw new SkillPackError("pack_unreadable", `install copy failed: ${String(err)}`, {
      packPath: input.sourceDir,
      cause: err,
    });
  }
  return { manifest, root: target };
}

export type RemovePackInput = { name: string; workspaceRoot: string };

export async function removePack(input: RemovePackInput): Promise<void> {
  const target = join(workspacePacksRoot(input.workspaceRoot), input.name);
  if (!existsSync(target)) {
    throw new SkillPackError("pack_not_found", `no installed pack named: ${input.name}`, {
      packPath: target,
    });
  }
  rmSync(target, { recursive: true, force: true });
}
