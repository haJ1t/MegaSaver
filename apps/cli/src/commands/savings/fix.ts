import type { KeyObject } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  nodeResolverDeps,
  resolveWorkspaceTokenSaverSettings,
  withActivationLock,
  writeExactRecord,
} from "@megasaver/context-gate";
import { formatDollarsSaved } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { type TokenSaverMode, encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { PRO_ANALYTICS_URL, type SavingsEventReader, defaultSavingsEventReader } from "./shared.js";

// fix-specific upsell: the shared string says "historical savings analytics",
// which would misname this feature. Same activation mechanics.
export const FIX_UPSELL = `Waste remediation is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type FixSaverReader = () => { enabled: boolean; mode: TokenSaverMode } | null;
export type FixMemoryFileReader = () => { path: string; bytes: number }[];
export type FixSaverWriter = (rec: { enabled: boolean; mode: TokenSaverMode }) => void;

export function defaultSaverReader(storeRoot: string, cwd: string): FixSaverReader {
  return () => {
    const r = resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps());
    if (r.source === "missing" || r.source === "invalid") return null;
    return { enabled: r.enabled, mode: r.mode };
  };
}

export function defaultMemoryFileReader(cwd: string): FixMemoryFileReader {
  return () => {
    const found: { path: string; bytes: number }[] = [];
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      try {
        const st = statSync(join(cwd, name));
        if (st.isFile()) found.push({ path: name, bytes: st.size });
      } catch {
        // absent — omitted; sizes only, content is never read.
      }
    }
    return found;
  };
}

export function defaultSaverWriter(storeRoot: string, cwd: string): FixSaverWriter {
  return (rec) =>
    withActivationLock(storeRoot, () =>
      writeExactRecord(storeRoot, encodeWorkspaceKey(cwd), { ...rec, scope: "exact" }),
    );
}

export type RunSavingsFixInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  readSaver: FixSaverReader;
  readMemoryFileSizes: FixMemoryFileReader;
  writeSaver: FixSaverWriter;
  apply?: boolean;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSavingsFix(input: RunSavingsFixInput): Promise<0 | 1> {
  // The entitlement gate runs FIRST — on the free path nothing is read,
  // computed, or written, even with --apply/--json set (spy-enforced).
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(FIX_UPSELL);
    return 0;
  }

  const { computeFixPlan } = await import("@megasaver/pro-analytics");
  const { events } = await input.readAllEvents();
  const saver = input.readSaver();
  const memoryFiles = input.readMemoryFileSizes();
  const plan = computeFixPlan(events, { saver, memoryFiles });

  const applied: { kind: string; was: string; now: string }[] = [];
  if (input.apply === true) {
    // R1/R2 are mutually exclusive and both resolve to the same write, so a
    // single pre-loop `was` and a fixed enabled/balanced record are correct.
    // A future rule with a different appliable write must derive it from the
    // action instead.
    const was = saver === null ? "absent" : saver.enabled ? saver.mode : "disabled";
    for (const action of plan.actions) {
      if (!action.appliable) continue;
      input.writeSaver({ enabled: true, mode: "balanced" });
      applied.push({ kind: action.kind, was, now: "enabled/balanced" });
    }
  }

  if (input.json) {
    input.stdout(JSON.stringify(input.apply === true ? { plan, applied } : { plan }));
    return 0;
  }

  if (plan.actions.length === 0) {
    input.stdout("Nothing to fix — no waste signals yet.");
    return 0;
  }

  input.stdout(
    `${plan.actions.length} finding(s) · ${formatDollarsSaved(plan.headline.dollarsReturned)} (est.) returned so far`,
  );
  input.stdout("");
  plan.actions.forEach((action, i) => {
    const tag = action.appliable ? "apply" : "advice";
    input.stdout(
      `${i + 1}. [${tag}] ${action.title} — ~${formatDollarsSaved(action.estDollarsReturned)} (est.)`,
    );
    input.stdout(`   ${action.detail}`);
    if (action.command) input.stdout(`   $ ${action.command}`);
  });

  const appliableCount = plan.actions.filter((a) => a.appliable).length;
  if (input.apply === true) {
    input.stdout("");
    if (applied.length === 0) {
      input.stdout(`Nothing to apply — ${plan.actions.length} advice item(s) above.`);
    } else {
      for (const ap of applied) {
        input.stdout(`applied: ${ap.kind} (was: ${ap.was} → now: ${ap.now})`);
      }
    }
  } else if (appliableCount > 0) {
    input.stdout("");
    input.stdout(`Run with --apply to apply ${appliableCount} fix(es).`);
  }
  return 0;
}

export const savingsFixCommand = defineCommand({
  meta: {
    name: "fix",
    description:
      "Turn waste findings into fixes — apply the safe ones, advise the rest (Mega Saver Pro).",
  },
  args: {
    apply: {
      type: "boolean",
      default: false,
      description: "Apply the [apply]-tagged fixes (writes only Mega Saver settings).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const cwd = process.cwd();
    const code = await runSavingsFix({
      storeRoot,
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(storeInput),
      readSaver: defaultSaverReader(storeRoot, cwd),
      readMemoryFileSizes: defaultMemoryFileReader(cwd),
      writeSaver: defaultSaverWriter(storeRoot, cwd),
      apply: !!args.apply,
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
