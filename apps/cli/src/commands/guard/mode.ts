import type { KeyObject } from "node:crypto";
import { DEFAULT_GUARD_STATE, readGuardState, writeGuardState } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export const GUARD_STRICT_UPSELL =
  "Strict (deny) mode is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export type RunGuardModeInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  mode: string;
  publicKey?: KeyObject | string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runGuardMode(input: RunGuardModeInput): Promise<0 | 1> {
  if (input.mode !== "warn" && input.mode !== "strict") {
    input.stderr(`error: mode must be one of warn|strict (got ${input.mode})`);
    return 1;
  }

  const { registry } = await ensureStoreReady(input.storeRoot);
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  if (input.mode === "strict") {
    const ent = checkEntitlement("savings-analytics", {
      storeRoot: input.storeRoot,
      now: input.now,
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(GUARD_STRICT_UPSELL);
      return 0;
    }
  }

  const current = readGuardState(input.storeRoot, project.id) ?? DEFAULT_GUARD_STATE;
  writeGuardState(input.storeRoot, project.id, { ...current, mode: input.mode });
  input.stdout(`guard mode: ${input.mode}`);
  return 0;
}

export const guardModeCommand = defineCommand({
  meta: { name: "mode", description: "Set the Mistake Firewall mode: warn or strict (Pro)." },
  args: {
    mode: { type: "positional", required: true, description: "warn|strict." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runGuardMode({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      cwd: process.cwd(),
      now: () => Date.now(),
      mode: typeof args.mode === "string" ? args.mode : "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
