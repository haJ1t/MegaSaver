import { readAllowlist, readKnownNames, readRegistryCache } from "@megasaver/context-gate";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export type RunFirewallStatusInput = {
  storeRoot: string;
  now: () => number;
  stdout: (line: string) => void;
};

const PRIVATE_NAME_NOTICE =
  "note: refresh sends bare package names to public registries; allowlist private names first";

export function runFirewallStatus(input: RunFirewallStatusInput): 0 {
  for (const ecosystem of ["npm", "pypi"] as const) {
    const cache = readRegistryCache(input.storeRoot, ecosystem);
    const seeds = readKnownNames(input.storeRoot, ecosystem).size;
    if (cache.refreshedAt === null) {
      input.stdout(`${ecosystem}: cache: none (${seeds} seed names active)`);
    } else {
      input.stdout(
        `${ecosystem}: cache: ${cache.names.length} names (refreshed ${cache.refreshedAt}; ${seeds} seed names active)`,
      );
    }
  }
  const allowlist = readAllowlist(input.storeRoot);
  input.stdout(`allowlist: ${allowlist.length} entries`);
  input.stdout(PRIVATE_NAME_NOTICE);
  return 0;
}

export const firewallStatusCommand = defineCommand({
  meta: { name: "status", description: "Package-firewall cache, seeds, and allowlist status." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const storeRoot = resolveStorePath(readStoreEnv(typeof args.store === "string" ? args.store : undefined));
    runFirewallStatus({ storeRoot, now: () => Date.now(), stdout: (line) => console.log(line) });
  },
});
