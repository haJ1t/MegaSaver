import { DEFAULT_GUARD_STATE, readGuardState, writeGuardState } from "@megasaver/core";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export type RunGuardMuteInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  failureId: string;
  unmute: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runGuardMute(input: RunGuardMuteInput): Promise<0 | 1> {
  if (input.failureId.trim() === "") {
    input.stderr("error: failure id must be a non-empty string");
    return 1;
  }

  const { registry } = await ensureStoreReady(input.storeRoot);
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  const current = readGuardState(input.storeRoot, project.id) ?? DEFAULT_GUARD_STATE;
  if (input.unmute) {
    const autoMuted = { ...current.autoMuted };
    delete autoMuted[input.failureId];
    writeGuardState(input.storeRoot, project.id, {
      ...current,
      mutedIds: current.mutedIds.filter((id) => id !== input.failureId),
      autoMuted,
    });
    input.stdout(`unmuted: ${input.failureId}`);
  } else {
    const mutedIds = current.mutedIds.includes(input.failureId)
      ? current.mutedIds
      : [...current.mutedIds, input.failureId];
    writeGuardState(input.storeRoot, project.id, { ...current, mutedIds });
    input.stdout(`muted: ${input.failureId}`);
  }
  return 0;
}

function muteRunner(unmute: boolean) {
  return async ({ args }: { args: { failureId?: unknown; store?: unknown } }) => {
    const code = await runGuardMute({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      cwd: process.cwd(),
      now: () => Date.now(),
      failureId: typeof args.failureId === "string" ? args.failureId : "",
      unmute,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  };
}

export const guardMuteCommand = defineCommand({
  meta: { name: "mute", description: "Silence a failure id in the Mistake Firewall." },
  args: {
    failureId: { type: "positional", required: true, description: "Failure/candidate id." },
    store: { type: "string", description: "Override store directory." },
  },
  run: muteRunner(false),
});

export const guardUnmuteCommand = defineCommand({
  meta: { name: "unmute", description: "Un-silence a failure id in the Mistake Firewall." },
  args: {
    failureId: { type: "positional", required: true, description: "Failure/candidate id." },
    store: { type: "string", description: "Override store directory." },
  },
  run: muteRunner(true),
});
