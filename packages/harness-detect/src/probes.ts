import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { DetectionProbes } from "./detect.js";

// PATHEXT order per Microsoft docs: .COM;.EXE;.BAT;.CMD is the default.
const WINDOWS_PATH_EXTENSIONS = [".com", ".exe", ".bat", ".cmd"] as const;

export type CreateNodeProbesInput = {
  readonly home: string;
  readonly projectRoot: string;
  readonly platform: NodeJS.Platform;
  readonly envPath: string;
};

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// Resolves "~/.cursor" → "<home>/.cursor". Only "~/..." is home-relative;
// anything else is rejected (never probe outside the injected home).
function resolveHomePath(home: string, homeRelativePath: string): string | null {
  if (!homeRelativePath.startsWith("~/")) return null;
  return join(home, homeRelativePath.slice(2));
}

// Resolves a project-root-relative marker. Absolute paths and ".." escapes
// are refused — probes must never reach outside the project root.
function resolveProjectPath(projectRoot: string, relativePath: string): string | null {
  if (isAbsolute(relativePath)) return null;
  const resolved = join(projectRoot, relativePath);
  const rootWithSep = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`;
  if (resolved !== projectRoot && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export function createNodeProbes(input: CreateNodeProbesInput): DetectionProbes {
  const isWin32 = input.platform === "win32";

  const binaryExists = (name: string): boolean => {
    if (name === "") return false;
    const candidates = isWin32 ? WINDOWS_PATH_EXTENSIONS.map((ext) => `${name}${ext}`) : [name];
    const pathEntries = input.envPath.split(delimiter).filter((entry) => entry !== "");
    for (const entry of pathEntries) {
      for (const candidate of candidates) {
        if (isFile(join(entry, candidate))) return true;
      }
    }
    return false;
  };

  const homePathExists = (homeRelativePath: string): boolean => {
    const resolved = resolveHomePath(input.home, homeRelativePath);
    return resolved !== null && exists(resolved);
  };

  const extensionDirExists = (parentHomeRelative: string, prefix: string): boolean => {
    const parent = resolveHomePath(input.home, parentHomeRelative);
    if (parent === null || !isDirectory(parent)) return false;
    let entries: readonly string[];
    try {
      entries = readdirSync(parent);
    } catch {
      return false;
    }
    return entries.some((entry) => entry.startsWith(prefix));
  };

  const projectMarkerExists = (relativePath: string): boolean => {
    const resolved = resolveProjectPath(input.projectRoot, relativePath);
    return resolved !== null && existsSync(resolved);
  };

  return { binaryExists, homePathExists, extensionDirExists, projectMarkerExists };
}
