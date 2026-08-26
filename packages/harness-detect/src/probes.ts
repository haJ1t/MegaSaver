import { constants, accessSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import type { DetectionProbes } from "./detect.js";

// PATHEXT order per Microsoft docs: .COM;.EXE;.BAT;.CMD is the default.
const WINDOWS_PATH_EXTENSIONS = [".com", ".exe", ".bat", ".cmd"] as const;

export type CreateNodeProbesInput = {
  readonly home: string;
  readonly projectRoot: string;
  readonly platform: NodeJS.Platform;
  readonly envPath: string;
};

// POSIX PATH contract: a binary must be an executable FILE (critic F3 — a
// 0644 script/docs file named `q` in a PATH dir must not count as Amazon Q).
// win32 has no executable bit: PATHEXT extension IS the executability check.
function isExecutableFile(path: string, isWin32: boolean): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (isWin32) return true;
    accessSync(path, constants.X_OK);
    return true;
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
// are refused — probes must never reach outside the project root. The path
// API matches the injected platform: on win32 `join` emits backslashes, so
// the boundary check MUST compare against the platform separator (a
// hardcoded "/" would reject every legit marker on Windows).
export function resolveProjectMarkerPath(
  projectRoot: string,
  relativePath: string,
  platform: NodeJS.Platform,
): string | null {
  const pathApi = platform === "win32" ? win32 : posix;
  if (pathApi.isAbsolute(relativePath)) return null;
  const resolved = pathApi.resolve(projectRoot, relativePath);
  const normalizedRoot = pathApi.resolve(projectRoot);
  const rootWithSep = normalizedRoot.endsWith(pathApi.sep)
    ? normalizedRoot
    : `${normalizedRoot}${pathApi.sep}`;
  if (resolved !== normalizedRoot && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export function createNodeProbes(input: CreateNodeProbesInput): DetectionProbes {
  const isWin32 = input.platform === "win32";

  const binaryExists = (name: string): boolean => {
    if (name === "") return false;
    const candidates = isWin32 ? WINDOWS_PATH_EXTENSIONS.map((ext) => `${name}${ext}`) : [name];
    // PATH entries split by the INJECTED platform's delimiter, not the
    // host's: detection semantics must be fully determined by `platform`
    // (production always injects process.platform; tests simulate win32 on
    // POSIX hosts and vice versa).
    const pathEntries = input.envPath.split(isWin32 ? ";" : ":").filter((entry) => entry !== "");
    for (const entry of pathEntries) {
      for (const candidate of candidates) {
        if (isExecutableFile(join(entry, candidate), isWin32)) return true;
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
    const resolved = resolveProjectMarkerPath(input.projectRoot, relativePath, input.platform);
    return resolved !== null && existsSync(resolved);
  };

  return { binaryExists, homePathExists, extensionDirExists, projectMarkerExists };
}
