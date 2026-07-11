import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../../store.js";
import { brainSyncInitCommand } from "./init.js";
import {
  type BrainSyncOpInput,
  runBrainSyncPull,
  runBrainSyncPush,
  runBrainSyncStatus,
} from "./ops.js";
import { brainSyncResetCommand } from "./reset.js";

export {
  type BrainSyncOpInput,
  runBrainSyncPull,
  runBrainSyncPush,
  runBrainSyncStatus,
} from "./ops.js";

type RunOp = (input: BrainSyncOpInput) => Promise<0 | 1>;

async function dispatch(run: RunOp, projectName: string, store: string | undefined): Promise<void> {
  const storeRoot = resolveStorePath(readStoreEnv(store));
  const code = await run({
    storeRoot,
    now: () => Date.now(),
    projectName,
    ensureStore: () => ensureStoreReady(storeRoot),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  });
  if (code !== 0) process.exitCode = code;
}

const opArgs = {
  projectName: { type: "positional", required: true, description: "Project name." },
  store: { type: "string", description: "Override store directory." },
} as const;

export const brainSyncPushCommand = defineCommand({
  meta: {
    name: "push",
    description: "Push the local project brain to the remote (Mega Saver Pro).",
  },
  args: opArgs,
  run: ({ args }) =>
    dispatch(
      runBrainSyncPush,
      String(args.projectName),
      typeof args.store === "string" ? args.store : undefined,
    ),
});

export const brainSyncPullCommand = defineCommand({
  meta: { name: "pull", description: "Pull and merge the remote project brain (Mega Saver Pro)." },
  args: opArgs,
  run: ({ args }) =>
    dispatch(
      runBrainSyncPull,
      String(args.projectName),
      typeof args.store === "string" ? args.store : undefined,
    ),
});

export const brainSyncStatusCommand = defineCommand({
  meta: { name: "status", description: "Show remote vs. local sync generations (Mega Saver Pro)." },
  args: opArgs,
  run: ({ args }) =>
    dispatch(
      runBrainSyncStatus,
      String(args.projectName),
      typeof args.store === "string" ? args.store : undefined,
    ),
});

// Subcommands-only: citty resolves the first non-flag arg against subCommands
// and throws "Unknown command" before ever invoking a parent `run`, so a bare
// `mega brain sync <project>` positional cannot coexist with the subcommands.
// The canonical `mega brain sync push <project>` is the sole push entrypoint.
export const brainSyncCommand = defineCommand({
  meta: {
    name: "sync",
    description: "Sync the project brain through your own S3-compatible bucket (Mega Saver Pro).",
  },
  subCommands: {
    init: brainSyncInitCommand,
    push: brainSyncPushCommand,
    pull: brainSyncPullCommand,
    status: brainSyncStatusCommand,
    reset: brainSyncResetCommand,
  },
});
