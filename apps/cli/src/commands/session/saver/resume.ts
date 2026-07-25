import { readNetEffectRecord, writeResumeOverride } from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../../store.js";

export function runSaverResume(input: {
  storeRoot: string;
  cwd: string;
  stdout: (line: string) => void;
}): 0 | 1 {
  const wk = encodeWorkspaceKey(input.cwd);
  const record = readNetEffectRecord(input.storeRoot, wk);
  if (record === null) {
    input.stdout(
      `mega session saver resume: no net-effect verdict for this workspace (${wk}) — nothing to resume.`,
    );
    return 0;
  }
  writeResumeOverride(input.storeRoot, wk, new Date().toISOString());
  input.stdout(
    `mega session saver resume: saver resumed for workspace ${wk} (verdict was ${record.verdict}; re-checks in 7 days).`,
  );
  return 0;
}

export const sessionSaverResumeCommand = defineCommand({
  meta: {
    name: "resume",
    description: "Lift a net-effect auto-pause for this workspace (re-checks after 7 days).",
  },
  args: { store: { type: "string", description: "Override store directory." } },
  run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    process.exitCode = runSaverResume({ storeRoot, cwd: process.cwd(), stdout: console.log });
  },
});
