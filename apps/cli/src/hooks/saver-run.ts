import { readFileSync } from "node:fs";
import {
  type FailureKind,
  nodeResolverDeps,
  recordCompletionHeartbeat,
  recordCompressionHeartbeat,
  recordDaemonFallbackHeartbeat,
  recordFailureHeartbeat,
  recordInvocationHeartbeat,
  resolveWorkspaceTokenSaverSettings,
} from "@megasaver/context-gate";
import {
  type RecordOverlayOutputInput,
  type RecordOverlayOutputResult,
  recordAndFilterOverlayOutput,
} from "@megasaver/core";
import { getRunningDaemon } from "@megasaver/daemon";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { maybeRunOverlayGc } from "./gc.js";
import { maybeRecordGuardOutcome } from "./guard-outcome.js";
import { readSessionIntent } from "./intent-run.js";
import {
  type SaverDecision,
  type SaverDeps,
  type SaverSettings,
  buildSaverDecision,
} from "./saver.js";

// Resolves activation from the cwd through the repository-family precedence, so
// a worktree inherits its repository's enable. null ⇒ disabled/passthrough.
function resolveSettings(storeRoot: string, cwd: string): SaverSettings | null {
  const r = resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps());
  return r.enabled ? { enabled: true, mode: r.mode } : null;
}

// Best-effort metadata-only heartbeats; a failure never blocks the tool call.
function recordInvocation(storeRoot: string, workspaceKey: string): void {
  try {
    recordInvocationHeartbeat(storeRoot, workspaceKey, new Date().toISOString());
  } catch {
    /* liveness is best-effort */
  }
}
function recordCompression(storeRoot: string, workspaceKey: string): void {
  try {
    recordCompressionHeartbeat(storeRoot, workspaceKey, new Date().toISOString());
  } catch {
    /* liveness is best-effort */
  }
}
function recordFailure(
  storeRoot: string,
  workspaceKey: string,
  kind: FailureKind,
  tsIso: string,
): void {
  try {
    recordFailureHeartbeat(storeRoot, workspaceKey, kind, tsIso);
  } catch {
    /* liveness is best-effort */
  }
}
function recordCompletion(storeRoot: string, workspaceKey: string, tsIso: string): void {
  try {
    recordCompletionHeartbeat(storeRoot, workspaceKey, tsIso);
  } catch {
    /* liveness is best-effort */
  }
}
function recordDaemonFallback(storeRoot: string, workspaceKey: string): void {
  try {
    recordDaemonFallbackHeartbeat(storeRoot, workspaceKey, new Date().toISOString());
  } catch {
    /* liveness is best-effort */
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const DAEMON_TIMEOUT_MS = 1500; // ponytail: short timeout; a hung socket must not stall the hook

/** Try to forward to the running daemon's /excerpt; fall back to in-process on any failure.
 *  Exported for tests. Never throws — every failure mode returns in-process result.
 *  E21: a daemon that EXISTED but whose POST failed/timed out counts one
 *  daemonFallbacks bump (behavior unchanged; the silent fallback becomes countable). */
export function makeRecord(storeRoot: string): SaverDeps["record"] {
  return async (input: RecordOverlayOutputInput): Promise<RecordOverlayOutputResult> => {
    let daemonFailed = false;
    try {
      const handle = await getRunningDaemon({ storeRoot });
      if (handle !== null) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DAEMON_TIMEOUT_MS);
        try {
          const {
            storeRoot: _sr,
            evidenceStoreRoot: _esr,
            now: _now,
            newId: _nid,
            ...daemonBody
          } = input;
          // ponytail: daemon excerptHandler supplies storeRoot itself; do NOT add evidenceStoreRoot
          const res = await handle.request("POST", "/excerpt", daemonBody, controller.signal);
          clearTimeout(timer);
          if (res.ok) {
            return (await res.json()) as RecordOverlayOutputResult;
          }
          daemonFailed = true;
        } catch {
          clearTimeout(timer);
          daemonFailed = true;
        }
      }
    } catch {
      // fall through to in-process
    }
    if (daemonFailed) recordDaemonFallback(storeRoot, input.workspaceKey);
    return recordAndFilterOverlayOutput(input);
  };
}

// Pure stdout renderer: the PostToolUse envelope on compress, "" on passthrough
// (no JSON = the model keeps the original output). Extracted so the envelope is
// testable without mocking fd 0.
export function renderSaverStdout(decision: SaverDecision): string {
  if (!("updatedToolOutput" in decision)) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: decision.updatedToolOutput,
    },
  });
}

// Always exits 0. On any failure emits nothing → the model keeps the original
// tool output (PostToolUse "no JSON" = no change). Never blocks the tool call.
export async function runSaverHookFromProcess(): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    // Guard outcome labeling must run BEFORE buildSaverDecision: decide()
    // passthroughs early on small outputs and failing re-runs are small.
    await maybeRecordGuardOutcome(payload, storeRoot);
    const deps: SaverDeps = {
      storeRoot,
      resolveSettings,
      readSessionIntent,
      record: makeRecord(storeRoot),
      recordInvocation,
      recordCompression,
      recordFailure,
      recordCompletion,
    };
    const decision = await buildSaverDecision(payload, deps);
    const s = renderSaverStdout(decision);
    if (s !== "") process.stdout.write(s);
    // C14: opportunistic store GC, at most once/day, only on the compression
    // path. Placed after the stdout write so the model's output is not
    // delayed by it; adds ≤~100ms once a day. Every failure is swallowed
    // inside.
    if ("updatedToolOutput" in decision) await maybeRunOverlayGc(storeRoot);
  } catch {
    // Swallow — best-effort; original output reaches the model.
  }
}
