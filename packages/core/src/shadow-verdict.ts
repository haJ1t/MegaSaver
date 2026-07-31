import { createHash } from "node:crypto";

/**
 * @scaffold SHADOW VERDICT SIMULATOR (NOT WIRED TO SHADOW WORKTREE EXECUTION)
 * WARNING: This is a scaffold helper for simulated verdict handles.
 * Real verdict evaluation requires Phase 4 shadow worktree execution pipeline.
 */
export interface ShadowVerdict {
  verdictId: string;
  isPassing: boolean;
  score: number;
  handle: string;
  summary: string;
  isScaffold: true;
}

export function evaluateShadowWorktreeScaffold(
  commitRef: string,
  simulatedTestsPass: boolean,
): ShadowVerdict {
  const hash = createHash("sha256")
    .update(`${commitRef}:${simulatedTestsPass}`)
    .digest("hex")
    .slice(0, 16);
  return {
    verdictId: `verd_${hash}`,
    isPassing: simulatedTestsPass,
    score: simulatedTestsPass ? 1.0 : 0.0,
    handle: `msr://verdict_${hash}`,
    summary: simulatedTestsPass
      ? "[Scaffold] Simulated PASS verdict"
      : "[Scaffold] Simulated FAIL verdict",
    isScaffold: true,
  };
}
