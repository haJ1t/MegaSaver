import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { type CoreRegistry, createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { z } from "zod";

export type ResolveStorePathInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
};

const storeFlagSchema = z.string().trim().min(1);

export function resolveStorePath(input: ResolveStorePathInput): string {
  const { storeFlag, cwd, home, xdgDataHome, platform, localAppData } = input;
  if (storeFlag !== undefined) {
    const trimmed = storeFlagSchema.parse(storeFlag);
    return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  }
  if (xdgDataHome && xdgDataHome.length > 0) {
    return resolve(xdgDataHome, "megasaver");
  }
  if (platform === "win32") {
    if (localAppData && localAppData.length > 0) {
      return resolve(localAppData, "megasaver");
    }
    if (home.length > 0) {
      return resolve(home, "AppData", "Local", "megasaver");
    }
    // Fail loud rather than resolve a relative "AppData/Local/megasaver" under
    // cwd (spec §A.1 footgun). Mirrors resolveBridgeStorePath's throw.
    throw new Error(
      "cannot resolve the default Windows store path: LOCALAPPDATA, USERPROFILE, and HOME are all unset",
    );
  }
  return resolve(home, ".local", "share", "megasaver");
}

// Boundary: read every env input in ONE place so the 19 CLI handlers stay
// one-liners. Windows has no HOME → fall back to USERPROFILE (spec §A.1).
export function readStoreEnv(storeFlag: string | undefined): ResolveStorePathInput {
  return {
    storeFlag,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    home: process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    xdgDataHome: process.env["XDG_DATA_HOME"],
    platform: process.platform,
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    localAppData: process.env["LOCALAPPDATA"],
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export type EnsureStoreReadyResult = {
  registry: CoreRegistry;
  initialized: boolean;
};

export async function ensureStoreReady(rootDir: string): Promise<EnsureStoreReadyResult> {
  const projectsPath = resolve(rootDir, "projects.json");
  const sessionsPath = resolve(rootDir, "sessions.json");
  const [rootExists, projectsExists, sessionsExists] = await Promise.all([
    exists(rootDir),
    exists(projectsPath),
    exists(sessionsPath),
  ]);
  const initialized = !(rootExists && projectsExists && sessionsExists);
  await initStore(rootDir);
  const registry = createJsonDirectoryCoreRegistry({ rootDir });
  return { registry, initialized };
}
