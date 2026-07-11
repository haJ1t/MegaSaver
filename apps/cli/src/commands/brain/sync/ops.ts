import { BrainSyncError, pull, push, status } from "@megasaver/brain-sync";
import { type BrainSyncCommonInput, buildProjectSyncContext, gate } from "./common.js";

export type BrainSyncOpInput = BrainSyncCommonInput & { projectName: string };

export async function runBrainSyncPush(input: BrainSyncOpInput): Promise<0 | 1> {
  if (!gate(input)) return 0;
  try {
    const ctx = await buildProjectSyncContext(input);
    if (ctx === null) return 1;
    const result = await push(ctx.deps);
    if (result.state === "pushed") {
      input.stdout(
        `pushed generation ${result.generation}${result.merged ? " (merged remote changes first)" : ""}`,
      );
    } else if (result.merged) {
      input.stdout(
        "merged remote changes — imported entries are suggested; run: mega memory approve",
      );
    } else {
      input.stdout(`already up to date (generation ${result.generation})`);
    }
    return 0;
  } catch (err) {
    if (err instanceof BrainSyncError) {
      input.stderr(`error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

export async function runBrainSyncPull(input: BrainSyncOpInput): Promise<0 | 1> {
  if (!gate(input)) return 0;
  try {
    const ctx = await buildProjectSyncContext(input);
    if (ctx === null) return 1;
    const result = await pull(ctx.deps);
    if (result.state === "empty") {
      input.stdout("remote is empty — run `mega brain sync push <project>` first");
    } else if (result.state === "merged") {
      input.stdout(
        `merged remote generation ${result.generation} — imported entries are suggested; run: mega memory approve`,
      );
    } else {
      input.stdout(`already up to date (generation ${result.generation})`);
    }
    return 0;
  } catch (err) {
    if (err instanceof BrainSyncError) {
      input.stderr(`error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

export async function runBrainSyncStatus(input: BrainSyncOpInput): Promise<0 | 1> {
  if (!gate(input)) return 0;
  try {
    const ctx = await buildProjectSyncContext(input);
    if (ctx === null) return 1;
    const result = await status(ctx.deps);
    if (result.state === "empty") {
      input.stdout("remote: empty");
    } else {
      input.stdout(
        `remote generation: ${result.remoteGeneration} / last seen: ${result.lastSeenGeneration} / up to date: ${result.upToDate ? "yes" : "no"} / updated: ${result.updatedAt}`,
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof BrainSyncError) {
      input.stderr(`error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}
