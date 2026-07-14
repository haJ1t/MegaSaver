import {
  DEFAULT_GUARD_STATE,
  type GuardEvent,
  readGuardEvents,
  readGuardState,
} from "@megasaver/core";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export type RunGuardStatusInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const isIntercept = (e: GuardEvent): e is Extract<GuardEvent, { type: "intercept" }> =>
  e.type === "intercept";
const isOutcome = (e: GuardEvent): e is Extract<GuardEvent, { type: "outcome" }> =>
  e.type === "outcome";

export async function runGuardStatus(input: RunGuardStatusInput): Promise<0 | 1> {
  const { registry } = await ensureStoreReady(input.storeRoot);
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  const state = readGuardState(input.storeRoot, project.id) ?? DEFAULT_GUARD_STATE;
  const month = new Date(input.now()).toISOString().slice(0, 7);
  const events = readGuardEvents({ root: input.storeRoot }, project.id).filter(
    (e) => e.createdAt.slice(0, 7) === month,
  );

  const intercepts = events.filter(isIntercept);
  const outcomes = events.filter(isOutcome);
  const warnX = intercepts.filter((e) => e.action === "warn").length;
  const denyY = intercepts.filter((e) => e.action === "deny").length;
  const recallZ = intercepts.filter((e) => e.action === "recall").length;
  const okA = outcomes.filter((e) => e.outcome === "overridden-ok").length;
  const failedB = outcomes.filter((e) => e.outcome === "overridden-failed").length;
  const unclassifiedC = outcomes.filter((e) => e.outcome === "overridden").length;
  const overriddenIds = new Set(outcomes.map((e) => e.interceptId));
  const heeded = intercepts.filter((e) => !overriddenIds.has(e.id)).length;
  const overridden = outcomes.length;
  const muted = state.mutedIds.length;

  if (input.json) {
    input.stdout(
      JSON.stringify({
        mode: state.mode,
        month,
        intercepts: intercepts.length,
        warn: warnX,
        deny: denyY,
        recall: recallZ,
        heeded,
        overridden,
        overriddenOk: okA,
        overriddenFailed: failedB,
        overriddenUnclassified: unclassifiedC,
        muted,
      }),
    );
    return 0;
  }

  input.stdout(`guard mode: ${state.mode}`);
  input.stdout(
    `intercepts this month: ${intercepts.length} (warn ${warnX} · deny ${denyY} · recall ${recallZ})`,
  );
  input.stdout(
    `heeded: ${heeded} · overridden: ${overridden} (ok ${okA} · failed ${failedB} · unclassified ${unclassifiedC})`,
  );
  input.stdout(
    `false-positive proxy: ${okA}/${warnX} warns overridden-ok (edit-tool intercepts are never outcome-classified)`,
  );
  input.stdout(`muted: ${muted}`);
  return 0;
}

export const guardStatusCommand = defineCommand({
  meta: { name: "status", description: "Show Mistake Firewall mode, intercepts, and mutes." },
  args: {
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runGuardStatus({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      cwd: process.cwd(),
      now: () => Date.now(),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
