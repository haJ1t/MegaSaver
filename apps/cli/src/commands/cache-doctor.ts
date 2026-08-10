import { defineCommand } from "citty";
import { analyzeCacheChurn } from "@megasaver/stats";
import type { TokenSaverEvent } from "@megasaver/stats";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type RunCacheDoctorInput = {
  storeRoot: string;
  json?: boolean;
  readEvents: (storeRoot: string) => TokenSaverEvent[];
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function defaultReadEvents(_storeRoot: string): TokenSaverEvent[] {
  return [];
}

export async function runCacheDoctor(input: RunCacheDoctorInput): Promise<0 | 1> {
  let events: TokenSaverEvent[];
  try {
    events = input.readEvents(input.storeRoot);
  } catch {
    events = [];
  }
  const result = analyzeCacheChurn(events);
  if (input.json) {
    input.stdout(JSON.stringify(result));
    return 0;
  }
  if (result.totalEvents === 0) {
    input.stdout("no cache churn events recorded \u2014 compression is keep_enabled (no data)");
    return 0;
  }
  input.stdout(
    `cache churn \u2014 events ${result.totalEvents}, invalidated ${result.invalidatedCount} (${(result.cacheInvalidationRate * 100).toFixed(1)}%)`,
  );
  input.stdout(`net savings USD ${result.netSavingsUsd} \u2014 recommendation: ${result.recommendation}`);
  if (result.perTool) {
    for (const [tool, v] of Object.entries(result.perTool)) {
      input.stdout(`  ${tool}: ${v.invalidatedCount}/${v.total}`);
    }
  }
  return 0;
}

export const cacheDoctorCommand = defineCommand({
  meta: {
    name: "cache-doctor",
    description: "Local cache churn health (free) \u2014 net USD + invalidation rate + recommendation.",
  },
  args: {
    json: { type: "boolean", default: false, description: "Emit CacheChurnResult as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runCacheDoctor({
      storeRoot,
      json: !!args.json,
      readEvents: defaultReadEvents,
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exitCode = code;
  },
});

// Re-export as audit --cache alias
export const auditCacheCommand = cacheDoctorCommand;
