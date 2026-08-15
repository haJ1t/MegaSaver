import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PackageRef } from "./package-refs.js";

export type LocalResolver = { resolves(ref: PackageRef): boolean };
export const LOCAL_WALK_MAX_LEVELS = 12;
export const LOCKFILE_READ_CAP_BYTES = 16 * 1024 * 1024;

// Linear indexOf scan, no RegExp — a hit counts only when the char before and
// after the match is absent or outside [A-Za-z0-9._-] (token boundary).
export function hasTokenBoundaryMatch(text: string, needle: string): boolean {
  const isTokenChar = (ch: string | undefined): boolean =>
    ch !== undefined && /[A-Za-z0-9._-]/.test(ch);
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) return false;
    const before = idx > 0 ? text[idx - 1] : undefined;
    const after = idx + needle.length < text.length ? text[idx + needle.length] : undefined;
    if (!isTokenChar(before) && !isTokenChar(after)) return true;
    from = idx + 1;
  }
}

const NPM_LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"] as const;
const PYPI_FILES = [
  "requirements.txt",
  "requirements-dev.txt",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  "Pipfile",
  "Pipfile.lock",
] as const;

function npmLockfileNeedles(name: string): readonly string[] {
  if (name.startsWith("@")) {
    return [`'${name}':`, `"${name}":`, `"node_modules/${name}"`, `/${name}@`];
  }
  return [`/${name}@`, `'${name}':`, `"${name}":`, `"node_modules/${name}"`, `"${name}@`, `\n${name}@`];
}

export function createLocalResolver(startDir: string): LocalResolver {
  const readCache = new Map<string, string | null>();
  const existsCache = new Map<string, boolean>();

  const readText = (path: string): string | null => {
    const cached = readCache.get(path);
    if (cached !== undefined) return cached;
    let result: string | null = null;
    try {
      const info = statSync(path);
      if (info.size <= LOCKFILE_READ_CAP_BYTES) {
        result = readFileSync(path, "utf8");
      }
    } catch {
      result = null;
    }
    readCache.set(path, result);
    return result;
  };

  const fileExists = (path: string): boolean => {
    const cached = existsCache.get(path);
    if (cached !== undefined) return cached;
    const ok = existsSync(path);
    existsCache.set(path, ok);
    return ok;
  };

  const levelResolvesNpm = (dir: string, name: string): boolean => {
    if (fileExists(join(dir, "node_modules", ...name.split("/")))) return true;
    const manifest = readText(join(dir, "package.json"));
    if (manifest !== null) {
      try {
        const parsed = JSON.parse(manifest) as Record<string, unknown>;
        const fields = [
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
        ];
        for (const field of fields) {
          const deps = parsed[field];
          if (typeof deps === "object" && deps !== null && name in deps) return true;
        }
      } catch {
        // unparseable manifest: not a resolution
      }
    }
    for (const lockfile of NPM_LOCKFILES) {
      const text = readText(join(dir, lockfile));
      if (text === null) continue;
      for (const needle of npmLockfileNeedles(name)) {
        if (text.includes(needle)) return true;
      }
    }
    return false;
  };

  const levelResolvesPypi = (dir: string, name: string): boolean => {
    const variants = [name, name.replaceAll("-", "_")];
    for (const variant of variants) {
      if (fileExists(join(dir, `${variant}.py`))) return true;
      if (fileExists(join(dir, variant, "__init__.py"))) return true;
    }
    for (const file of PYPI_FILES) {
      const text = readText(join(dir, file));
      if (text === null) continue;
      const haystack = text.toLowerCase();
      for (const variant of variants) {
        if (hasTokenBoundaryMatch(haystack, variant.toLowerCase())) return true;
      }
    }
    return false;
  };

  return {
    resolves: (ref: PackageRef): boolean => {
      let probe = startDir;
      for (let level = 0; level < LOCAL_WALK_MAX_LEVELS; level += 1) {
        const resolved =
          ref.ecosystem === "npm"
            ? levelResolvesNpm(probe, ref.name)
            : levelResolvesPypi(probe, ref.name);
        if (resolved) return true;
        const hasGit = fileExists(join(probe, ".git"));
        if (hasGit) return false;
        const parent = dirname(probe);
        if (parent === probe) return false;
        probe = parent;
      }
      return false;
    },
  };
}
