import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";
import { NPM_TOP } from "./data/npm-top.js";
import { PYPI_TOP } from "./data/pypi-top.js";
import { type PackageEcosystem, type PackageRef, isValidPackageName } from "./package-refs.js";

export type AllowlistEntry = { name: string; ecosystem: PackageEcosystem; addedAt: string };
export const REGISTRY_CACHE_MAX_NAMES = 20_000;

const cacheSchema = z
  .object({
    version: z.literal(1),
    ecosystem: z.enum(["npm", "pypi"]),
    refreshedAt: z.string(),
    names: z.array(z.string().max(214)).max(REGISTRY_CACHE_MAX_NAMES),
  })
  .strict();

const allowlistEntrySchema = z
  .object({
    name: z.string().max(214),
    ecosystem: z.enum(["npm", "pypi"]),
    addedAt: z.string(),
  })
  .strict();

const allowlistSchema = z
  .object({ version: z.literal(1), entries: z.array(allowlistEntrySchema).max(2_000) })
  .strict();

export function registryCachePath(storeRoot: string, ecosystem: PackageEcosystem): string {
  return join(storeRoot, "firewall", "registry-cache", `${ecosystem}.json`);
}

export function allowlistPath(storeRoot: string): string {
  return join(storeRoot, "firewall", "allowlist.json");
}

export function readRegistryCache(
  storeRoot: string,
  ecosystem: PackageEcosystem,
): { refreshedAt: string | null; names: string[] } {
  const path = registryCachePath(storeRoot, ecosystem);
  if (!existsSync(path)) return { refreshedAt: null, names: [] };
  try {
    // isFile() gate: a FIFO at the cache path would block readFileSync
    // forever on the hook path (critic B1).
    if (!statSync(path).isFile()) return { refreshedAt: null, names: [] };
    const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success || parsed.data.ecosystem !== ecosystem) {
      return { refreshedAt: null, names: [] };
    }
    return { refreshedAt: parsed.data.refreshedAt, names: parsed.data.names };
  } catch {
    return { refreshedAt: null, names: [] };
  }
}

const SEEDS: Readonly<Record<PackageEcosystem, readonly string[]>> = {
  npm: NPM_TOP,
  pypi: PYPI_TOP,
};

export function readKnownNames(
  storeRoot: string,
  ecosystem: PackageEcosystem,
): ReadonlySet<string> {
  const { names } = readRegistryCache(storeRoot, ecosystem);
  const known = new Set<string>(SEEDS[ecosystem]);
  for (const name of names) known.add(name);
  return known;
}

function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  try {
    renameSync(tmp, path);
  } catch {
    // Windows rename-over-existing fails; unlink then rename (saver-store
    // precedent) — the worst case is a re-read of the previous content.
    unlinkSync(path);
    renameSync(tmp, path);
  }
}

export function appendCachedNames(
  storeRoot: string,
  ecosystem: PackageEcosystem,
  names: readonly string[],
  nowIso: string,
): { added: number; total: number; capped: boolean; locked: boolean } {
  const path = registryCachePath(storeRoot, ecosystem);
  mkdirSync(join(storeRoot, "firewall", "registry-cache"), { recursive: true });
  let result = { added: 0, total: 0, capped: false };
  // Read-modify-write INSIDE the lock so concurrent refreshes cannot lose
  // updates (architect m9).
  const locked = withFileLock(`${path}.lock`, { deadlineMs: 250, staleMs: 5_000 }, () => {
    const current = readRegistryCache(storeRoot, ecosystem);
    const known = new Set(readKnownNames(storeRoot, ecosystem)); // seeds ∪ cache: dedupe against both
    const cacheOnly = new Set(current.names);
    let added = 0;
    let hitCap = false;
    for (const name of names) {
      if (!isValidPackageName(name, ecosystem)) continue;
      if (known.has(name)) continue;
      if (cacheOnly.size >= REGISTRY_CACHE_MAX_NAMES) {
        hitCap = true;
        break;
      }
      known.add(name);
      cacheOnly.add(name);
      added += 1;
    }
    const sorted = [...cacheOnly].sort();
    const capped = hitCap;
    atomicWriteJson(path, {
      version: 1,
      ecosystem,
      refreshedAt: nowIso,
      names: sorted,
    });
    result = { added, total: sorted.length, capped };
  });
  if (!locked) {
    return {
      added: 0,
      total: readRegistryCache(storeRoot, ecosystem).names.length,
      capped: false,
      locked: false,
    };
  }
  return { ...result, locked: true };
}

export function readAllowlist(storeRoot: string): AllowlistEntry[] {
  const path = allowlistPath(storeRoot);
  if (!existsSync(path)) return [];
  try {
    // isFile() gate: a FIFO at the allowlist path would block readFileSync
    // forever on the hook path (critic B1).
    if (!statSync(path).isFile()) return [];
    const parsed = allowlistSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data.entries : [];
  } catch {
    return [];
  }
}

export function appendAllowlistEntry(storeRoot: string, entry: AllowlistEntry): boolean {
  if (!isValidPackageName(entry.name, entry.ecosystem)) return false;
  const path = allowlistPath(storeRoot);
  mkdirSync(join(storeRoot, "firewall"), { recursive: true });
  let ok = false;
  const locked = withFileLock(`${path}.lock`, { deadlineMs: 250, staleMs: 5_000 }, () => {
    const entries = readAllowlist(storeRoot);
    if (entries.some((e) => e.name === entry.name && e.ecosystem === entry.ecosystem)) {
      ok = true;
      return;
    }
    if (entries.length >= 2_000) {
      ok = false;
      return;
    }
    atomicWriteJson(path, { version: 1, entries: [...entries, entry] });
    ok = true;
  });
  return locked && ok;
}

export function isAllowlisted(storeRoot: string, ref: PackageRef): boolean {
  return readAllowlist(storeRoot).some(
    (entry) => entry.name === ref.name && entry.ecosystem === ref.ecosystem,
  );
}
