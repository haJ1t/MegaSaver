import { isAbsolute, resolve } from "node:path";
import { readEvents } from "@megasaver/mesh";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, meshUnavailableMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

export type RunMeshEventsInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  json?: boolean;
  since?: string;
  repo?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function resolveStoreRoot(input: RunMeshEventsInput): string {
  if (input.storeFlag !== undefined) {
    const trimmed = input.storeFlag.trim();
    if (trimmed.length === 0) throw new Error("store path must be non-empty");
    return isAbsolute(trimmed) ? trimmed : resolve(input.cwd, trimmed);
  }
  if (input.home !== undefined) {
    return resolveStorePath({
      storeFlag: undefined,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform ?? process.platform,
      localAppData: input.localAppData,
    });
  }
  return resolveStorePath(readStoreEnv(undefined));
}

export async function runMeshEvents(input: RunMeshEventsInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    storeRoot = resolveStoreRoot(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    await ensureStoreReady(storeRoot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const cli = meshUnavailableMessage(detail);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let events: ReturnType<typeof readEvents> = [];
  try {
    events = readEvents(storeRoot, {
      ...(input.since !== undefined ? { since: input.since } : {}),
      ...(input.repo !== undefined ? { repo: input.repo } : {}),
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (input.json) {
    input.stdout(JSON.stringify(events, null, 2));
    return 0;
  }

  if (events.length === 0) {
    input.stdout("events: 0");
    input.stdout("no events");
    return 0;
  }

  input.stdout(`events (${events.length})`);
  for (const e of events) {
    input.stdout(JSON.stringify(e));
  }
  return 0;
}

export const meshEventsCommand = defineCommand({
  meta: { name: "events", description: "List mesh bus events (events.jsonl)." },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    since: { type: "string", description: "ISO datetime — only events with createdAt ≥ since." },
    repo: { type: "string", description: "Filter by repo key (reserved, no-op in Phase 1)." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const json = Boolean((args as { json?: unknown }).json);
    const since =
      typeof (args as { since?: unknown }).since === "string"
        ? ((args as { since: string }).since as string)
        : undefined;
    const repo =
      typeof (args as { repo?: unknown }).repo === "string"
        ? ((args as { repo: string }).repo as string)
        : undefined;
    const env = readStoreEnv(storeFlag);
    const code = await runMeshEvents({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      json,
      ...(since !== undefined ? { since } : {}),
      ...(repo !== undefined ? { repo } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
