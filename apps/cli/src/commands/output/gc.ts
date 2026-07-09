import { pruneOlderThan } from "@megasaver/content-store";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { readStoreEnv, resolveStorePath } from "../../store.js";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;

function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

export type RunOutputGcInput = {
  storeRoot: string;
  now: () => number;
  days?: string;
  json: boolean;
  /** Override for tests; defaults to content-store pruneOlderThan. */
  prune?: typeof pruneOlderThan;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runOutputGc(input: RunOutputGcInput): Promise<0 | 1> {
  const prune = input.prune ?? pruneOlderThan;
  let days = DEFAULT_DAYS;
  if (input.days !== undefined) {
    const parsed = parseDays(input.days);
    if (parsed === null) {
      input.stderr("error: Invalid --days (integer 1-3650)");
      return 1;
    }
    days = parsed;
  }
  try {
    const { removed } = await prune({
      storeRoot: input.storeRoot,
      olderThan: new Date(input.now() - days * DAY_MS),
    });
    if (input.json) {
      input.stdout(JSON.stringify({ removed }));
    } else {
      input.stdout(`removed ${removed} chunk set(s)`);
    }
    return 0;
  } catch (error) {
    input.stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export const outputGcCommand = defineCommand({
  meta: {
    name: "gc",
    description: "Delete stored chunk sets older than the retention window (default 30 days).",
  },
  args: {
    days: { type: "string", description: "Retention in days (default 30)." },
    json: { type: "boolean", default: false, description: "Emit {removed} as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    let storeRoot: string;
    try {
      storeRoot = resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      );
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "store" });
      console.error(cli.message);
      process.exitCode = cli.exitCode;
      return;
    }
    const code = await runOutputGc({
      storeRoot,
      now: () => Date.now(),
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
