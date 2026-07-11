import { BrainSyncError, MANIFEST_KEY } from "@megasaver/brain-sync";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../../store.js";
import { type BrainSyncCommonInput, buildProjectSyncContext, gate } from "./common.js";

export type RunBrainSyncResetInput = BrainSyncCommonInput & {
  projectName: string;
  force?: boolean;
};

export async function runBrainSyncReset(input: RunBrainSyncResetInput): Promise<0 | 1> {
  if (!gate(input)) return 0;

  if (!input.force) {
    input.stderr(
      `error: this permanently deletes the remote manifest for "${input.projectName}" — its sync history becomes unreadable. Re-run with --force to confirm.`,
    );
    return 1;
  }

  try {
    const ctx = await buildProjectSyncContext(input);
    if (ctx === null) return 1;
    await ctx.deps.transport.deleteObject(MANIFEST_KEY);
    input.stdout("Remote manifest deleted — the next push starts a new chain at generation 1.");
    return 0;
  } catch (err) {
    if (err instanceof BrainSyncError) {
      input.stderr(`error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

export const brainSyncResetCommand = defineCommand({
  meta: {
    name: "reset",
    description: "Delete the remote sync manifest for a project (Mega Saver Pro).",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    force: { type: "boolean", default: false, description: "Confirm the destructive reset." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runBrainSyncReset({
      storeRoot,
      now: () => Date.now(),
      projectName: String(args.projectName),
      force: !!args.force,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
