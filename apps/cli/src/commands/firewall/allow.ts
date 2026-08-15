import {
  type PackageEcosystem,
  appendAllowlistEntry,
  isValidPackageName,
  normalizePypiName,
} from "@megasaver/context-gate";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export type RunFirewallAllowInput = {
  storeRoot: string;
  name: string;
  ecosystem: PackageEcosystem;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runFirewallAllow(input: RunFirewallAllowInput): 0 | 1 {
  const normalized = input.ecosystem === "pypi" ? normalizePypiName(input.name) : input.name;
  if (!isValidPackageName(normalized, input.ecosystem)) {
    input.stderr(
      `error: invalid ${input.ecosystem} package name "${input.name}" (expected ${input.ecosystem} name grammar)`,
    );
    return 1;
  }
  const ok = appendAllowlistEntry(input.storeRoot, {
    name: normalized,
    ecosystem: input.ecosystem,
    addedAt: new Date(input.now()).toISOString(),
  });
  if (!ok) {
    input.stderr("error: could not write the allowlist (lock contention or cap reached)");
    return 1;
  }
  input.stdout(`allowed ${normalized} (${input.ecosystem})`);
  return 0;
}

export const firewallAllowCommand = defineCommand({
  meta: { name: "allow", description: "Add a name to the package-firewall allowlist." },
  args: {
    name: { type: "positional", description: "Package name.", required: true },
    ecosystem: { type: "string", description: "npm or pypi.", required: true },
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = runFirewallAllow({
      storeRoot,
      name: String(args.name),
      ecosystem: (typeof args.ecosystem === "string" ? args.ecosystem : "npm") as PackageEcosystem,
      now: () => Date.now(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
