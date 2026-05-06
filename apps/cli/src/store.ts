import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  type CoreRegistry,
  createJsonDirectoryCoreRegistry,
  initStore,
} from "@megasaver/core";
import { z } from "zod";

export type ResolveStorePathInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
};

const storeFlagSchema = z.string().trim().min(1);

export function resolveStorePath(input: ResolveStorePathInput): string {
  const { storeFlag, cwd, home, xdgDataHome } = input;
  if (storeFlag !== undefined) {
    const trimmed = storeFlagSchema.parse(storeFlag);
    return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  }
  if (xdgDataHome && xdgDataHome.length > 0) {
    return resolve(xdgDataHome, "megasaver");
  }
  return resolve(home, ".local", "share", "megasaver");
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

export async function ensureStoreReady(
  rootDir: string,
): Promise<EnsureStoreReadyResult> {
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
