import type { KeyObject } from "node:crypto";
import { type GuardEvent, readGuardEvents } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export const GUARD_EVENTS_UPSELL =
  "The guard event ledger is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export type RunGuardEventsInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  limit?: number;
  json?: boolean;
  publicKey?: KeyObject | string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type JoinedEvent = Extract<GuardEvent, { type: "intercept" }> & {
  outcome: "overridden-ok" | "overridden-failed" | "overridden" | null;
};

export async function runGuardEvents(input: RunGuardEventsInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(GUARD_EVENTS_UPSELL);
    return 0;
  }

  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit <= 0) {
    input.stderr(`error: --limit must be a positive integer (got ${input.limit})`);
    return 1;
  }

  const { registry } = await ensureStoreReady(input.storeRoot);
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  const events = readGuardEvents({ root: input.storeRoot }, project.id);
  const outcomeByIntercept = new Map<string, JoinedEvent["outcome"]>();
  for (const e of events) {
    if (e.type === "outcome") outcomeByIntercept.set(e.interceptId, e.outcome);
  }
  const joined: JoinedEvent[] = events
    .filter((e): e is Extract<GuardEvent, { type: "intercept" }> => e.type === "intercept")
    .map((e) => ({ ...e, outcome: outcomeByIntercept.get(e.id) ?? null }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  if (input.json) {
    input.stdout(JSON.stringify(joined));
    return 0;
  }

  if (joined.length === 0) {
    input.stdout("No guard intercepts recorded yet.");
    return 0;
  }

  for (const e of joined) {
    const when = `${e.createdAt.slice(0, 10)} ${e.createdAt.slice(11, 16)}`;
    const cmd = e.normalizedCommand ?? "(edit)";
    input.stdout(
      `${when}  ${e.tier} ${e.action}   ${cmd}  ~${e.avoidedTokens} tokens (estimated)  → ${e.outcome ?? "heeded"}`,
    );
  }
  return 0;
}

export const guardEventsCommand = defineCommand({
  meta: { name: "events", description: "List Mistake Firewall intercepts and outcomes (Pro)." },
  args: {
    limit: { type: "string", description: "Max rows (default 20)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const limit = args.limit === undefined ? undefined : Number.parseInt(String(args.limit), 10);
    const code = await runGuardEvents({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      cwd: process.cwd(),
      now: () => Date.now(),
      ...(limit === undefined ? {} : { limit }),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
