import { readFileSync } from "node:fs";
import {
  type PackageEcosystem,
  type PackageRef,
  appendCachedNames,
  firewallEventSchema,
  firewallLogPath,
  isValidPackageName,
  normalizePypiName,
  readAllowlist,
} from "@megasaver/context-gate";
import { defineCommand } from "citty";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export const REFRESH_MAX_NAMES = 100;
export const REFRESH_TIMEOUT_MS = 5_000;

// The ONLY fetch() in the feature: the offline structural test
// (package-firewall-offline.test.ts) pins this literal as its
// non-vacuity probe — every hook-path module must stay fetch-free.
export const defaultFirewallFetch: typeof fetch = (input, init) => fetch(input, init);

export function registryUrl(ref: PackageRef): string {
  if (ref.ecosystem === "npm") {
    return `https://registry.npmjs.org/${encodeURIComponent(ref.name)}`;
  }
  return `https://pypi.org/pypi/${ref.name}/json`;
}

export type RunFirewallRefreshInput = {
  storeRoot: string;
  names: string[];
  ecosystem: PackageEcosystem | undefined;
  fetchImpl: typeof fetch;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// Boundary validation (code-conventions §8): an ecosystem value that is not a
// member of the closed union would flow into node:path.join via
// registryCachePath — traversal-shaped values write OUTSIDE the store.
const ECOSYSTEM = z.enum(["npm", "pypi"]);

function recentLedgerUnknowns(storeRoot: string): PackageRef[] {
  try {
    const raw = readFileSync(firewallLogPath(storeRoot), "utf8");
    const cutoff = Date.now() - 30 * 24 * 60 * 60_000;
    const refs: PackageRef[] = [];
    const seen = new Set<string>();
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      // Per-line tolerance (critic M2): a corrupt tail from a crashed writer
      // must not wipe the whole refresh set — skip the line, keep the rest.
      let parsedLine: unknown;
      try {
        parsedLine = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = firewallEventSchema.safeParse(parsedLine);
      if (!parsed.success) continue;
      const event = parsed.data;
      if (event.kind !== "unknown-package") continue;
      if (event.packageName === undefined || event.ecosystem === undefined) continue;
      if (Date.parse(event.at) < cutoff) continue;
      const key = `${event.ecosystem}:${event.packageName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ name: event.packageName, ecosystem: event.ecosystem });
    }
    return refs;
  } catch {
    return [];
  }
}

export async function runFirewallRefresh(input: RunFirewallRefreshInput): Promise<0 | 1> {
  if (input.ecosystem !== undefined && !ECOSYSTEM.safeParse(input.ecosystem).success) {
    input.stderr(`error: invalid ecosystem "${input.ecosystem}" (expected npm or pypi)`);
    return 1;
  }
  let refs: PackageRef[];
  if (input.names.length > 0) {
    // Architect M5: every CLI-provided name is grammar-validated BEFORE any
    // fetch or cache append — junk names never reach public registries.
    refs = [];
    for (const name of input.names) {
      const ecosystem = input.ecosystem ?? "npm";
      const normalized = ecosystem === "pypi" ? normalizePypiName(name) : name;
      if (!isValidPackageName(normalized, ecosystem)) {
        input.stderr(`error: invalid ${ecosystem} package name "${name}"`);
        return 1;
      }
      refs.push({ name: normalized, ecosystem });
    }
  } else {
    refs = recentLedgerUnknowns(input.storeRoot);
    if (refs.length === 0) {
      input.stdout("nothing to refresh (no names given and no ledger unknowns)");
      return 0;
    }
  }

  const allowlisted = readAllowlist(input.storeRoot);
  const allowlistedKeys = new Set(allowlisted.map((e) => `${e.ecosystem}:${e.name}`));
  const toRefresh: PackageRef[] = [];
  for (const ref of refs) {
    if (allowlistedKeys.has(`${ref.ecosystem}:${ref.name}`)) {
      input.stdout(`skipped (allowlisted): ${ref.name}`);
      continue;
    }
    toRefresh.push(ref);
  }
  const capped = toRefresh.slice(0, REFRESH_MAX_NAMES);

  const verified: Map<PackageEcosystem, string[]> = new Map();
  for (const ref of capped) {
    try {
      const res = await input.fetchImpl(registryUrl(ref), {
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (res.status === 200) {
        input.stdout(`${ref.name} verified`);
        const list = verified.get(ref.ecosystem) ?? [];
        list.push(ref.name);
        verified.set(ref.ecosystem, list);
      } else if (res.status === 404) {
        input.stdout(`${ref.name} NOT FOUND — likely hallucinated`);
      } else {
        input.stdout(`${ref.name} unverified (HTTP ${res.status})`);
      }
    } catch {
      input.stdout(`${ref.name} unverified (network error)`);
    }
  }

  const nowIso = new Date(input.now()).toISOString();
  let lockFailure = false;
  for (const [ecosystem, names] of verified) {
    const res = appendCachedNames(input.storeRoot, ecosystem, names, nowIso);
    if (!res.locked) lockFailure = true;
    if (res.capped) {
      input.stdout(`note: ${ecosystem} cache at cap (${res.total}); older names were not evicted`);
    }
  }
  if (lockFailure) {
    input.stderr("error: cache write failed (lock contention) — verified names were not persisted");
    return 1;
  }
  return 0;
}

export const firewallRefreshCommand = defineCommand({
  meta: {
    name: "refresh",
    description: "Verify package names against the public registries (network).",
  },
  args: {
    names: {
      type: "positional",
      description: "Names to verify (default: recent ledger unknowns).",
    },
    ecosystem: { type: "string", description: "npm or pypi (required when names are given)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const names =
      typeof args.names === "string" ? [args.names] : ((args.names as string[] | undefined) ?? []);
    const ecosystem =
      typeof args.ecosystem === "string" ? (args.ecosystem as PackageEcosystem) : undefined;
    const code = await runFirewallRefresh({
      storeRoot,
      names,
      ecosystem,
      fetchImpl: defaultFirewallFetch,
      now: () => Date.now(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
