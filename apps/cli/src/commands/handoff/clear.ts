import { join } from "node:path";
import { defineCommand } from "citty";
import { invalidTargetMessage } from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export type RunHandoffClearInput = {
  cwd: string;
  target?: string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// Free surface, no entitlement gate: removing injected content is never gated.
export async function runHandoffClear(input: RunHandoffClearInput): Promise<0 | 1> {
  const { KNOWN_TARGETS, isKnownTargetId } = await import("../../known-targets.js");
  if (input.target !== undefined && !isKnownTargetId(input.target)) {
    input.stderr(invalidTargetMessage(input.target).message);
    return 1;
  }

  const { registry } = await input.ensureStore();
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  const {
    MEGA_SAVER_HANDOFF_BLOCK_START,
    readTargetFile,
    upsertHandoffBlockText,
    writeTargetFile,
  } = await import("@megasaver/connectors-shared");

  const targets = KNOWN_TARGETS.filter((t) => input.target === undefined || t.id === input.target);
  let anyFailed = false;
  for (const target of targets) {
    try {
      const absPath = join(project.rootPath, target.relativePath);
      const existing = await readTargetFile(absPath);
      if (existing === null) {
        if (input.target !== undefined) {
          input.stdout(`${target.id}: skipped (no ${target.relativePath})`);
        }
        continue;
      }
      if (!existing.includes(MEGA_SAVER_HANDOFF_BLOCK_START)) {
        if (input.target !== undefined) {
          input.stdout(`${target.id}: no handoff block`);
        }
        continue;
      }
      await writeTargetFile({ absPath, content: upsertHandoffBlockText(existing, "") });
      input.stdout(`${target.id}: cleared handoff block`);
    } catch (err) {
      anyFailed = true;
      input.stderr(`${target.id}: error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return anyFailed ? 1 : 0;
}

export const handoffClearCommand = defineCommand({
  meta: {
    name: "clear",
    description: "Remove the HANDOFF block from agent config files (free).",
  },
  args: {
    target: { type: "string", description: "Connector target (default: all present targets)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runHandoffClear({
      cwd: process.cwd(),
      ...(typeof args.target === "string" ? { target: args.target } : {}),
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
