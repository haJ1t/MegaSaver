import type { ChildProcess } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import { type ChunkSet, saveChunkSet } from "@megasaver/content-store";
import { type FilterOutputResult, filterOutput } from "@megasaver/output-filter";
import { type PolicyDenyCode, evaluateCommand } from "@megasaver/policy";
import { type SessionId, modeToBudget } from "@megasaver/shared";
import { type TokenSaverEvent, appendEvent } from "@megasaver/stats";
import type { OrchestratorRegistry } from "./registry-port.js";
import { defaultNewId, defaultNow, resolveEffectiveSettings } from "./read.js";

// Injectable spawn so unit tests never start a real process (CRITICAL §12).
export type RunCommandSpawn = typeof nodeSpawn;

export type RunOutputExecInput = {
  registry: OrchestratorRegistry;
  storeRoot: string;
  sessionId: SessionId;
  command: string;
  args: readonly string[];
  intent: string;
  // Computed by the CLI wrapper from process.env.MEGASAVER_ORIGIN_PID (or the
  // root pid) and injected so the orchestrator never reads process.env itself.
  originPid: string;
  timeoutMs: number;
  maxBytes: number;
  spawn?: RunCommandSpawn;
  now?: () => string;
  newId?: () => string;
};

export type ExecResult = FilterOutputResult & {
  childExitCode: number | null;
  terminated?: "timeout" | "max_bytes";
};

export type RunOutputExecResult =
  | { ok: true; result: ExecResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "command_denied"; code: PolicyDenyCode }
  | { ok: false; reason: "command_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };

// Grace before SIGKILL after SIGTERM on a forced termination (§3.5).
const KILL_GRACE_MS = 2_000;
// Hard ceiling on the filter budget: 2 * modeToBudget("safe") (§5).
const MAX_RETURNED_CEILING = 2 * modeToBudget("safe");

type Capture = {
  raw: string;
  terminated?: "timeout" | "max_bytes";
  childExitCode: number | null;
};

type SpawnOutcome =
  | { ok: true; capture: Capture }
  | { ok: false; reason: "command_failed"; detail: string };

// Spawn the child, combine stdout+stderr in arrival order, and enforce the two
// caller bounds (timeout, max-bytes). On either bound the child is killed but
// the partial capture is returned (a partial chunkSet beats none, §3.5). The
// manual timer is used (not spawn's `timeout` option) so we own the signal.
function runChild(input: {
  spawn: RunCommandSpawn;
  command: string;
  args: readonly string[];
  cwd: string;
  originPid: string;
  timeoutMs: number;
  maxBytes: number;
}): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolve) => {
    let child: ChildProcess;
    try {
      child = input.spawn(input.command, [...input.args], {
        cwd: input.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, MEGASAVER_ORIGIN_PID: input.originPid },
      });
    } catch (err) {
      resolve({ ok: false, reason: "command_failed", detail: messageOf(err) });
      return;
    }

    const buffers: Buffer[] = [];
    let captured = 0;
    let terminated: "timeout" | "max_bytes" | undefined;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const timeoutTimer = setTimeout(() => {
      terminated = "timeout";
      forceKill();
    }, input.timeoutMs);

    function forceKill(): void {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }

    function append(chunk: Buffer): void {
      if (terminated !== undefined) return;
      const remaining = input.maxBytes - captured;
      if (chunk.length >= remaining) {
        if (remaining > 0) {
          buffers.push(chunk.subarray(0, remaining));
          captured += remaining;
        }
        terminated = "max_bytes";
        forceKill();
        return;
      }
      buffers.push(chunk);
      captured += chunk.length;
    }

    child.stdout?.on("data", (c: Buffer) => append(c));
    child.stderr?.on("data", (c: Buffer) => append(c));

    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve({ ok: false, reason: "command_failed", detail: err.message });
    });

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve({
        ok: true,
        capture: {
          raw: Buffer.concat(buffers).toString("utf8"),
          ...(terminated !== undefined ? { terminated } : {}),
          // A bound-killed child has no meaningful exit code (§3.10).
          childExitCode: terminated !== undefined ? null : code,
        },
      });
    });
  });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Steps 3b–10 of §3: policy gate BEFORE spawn, redact (inside filterOutput)
// BEFORE store, store BEFORE stats. This order is load-bearing and asserted by
// the orchestrator tests (spawn-never-called on every denial branch).
export async function runOutputExecCommand(
  input: RunOutputExecInput,
): Promise<RunOutputExecResult> {
  const settings = resolveEffectiveSettings(input.registry, input.sessionId);
  if (settings === null) return { ok: false, reason: "session_not_found" };

  // Policy gate. The recursive_megasaver conjunct is enforced here via the
  // injected originPid (evaluateCommand compares it against String(process.pid)).
  const verdict = evaluateCommand({
    command: input.command,
    args: input.args,
    project: settings.projectId,
    env: { MEGASAVER_ORIGIN_PID: input.originPid },
  });
  if (!verdict.allowed) return { ok: false, reason: "command_denied", code: verdict.reason };

  const spawn = input.spawn ?? nodeSpawn;
  const outcome = await runChild({
    spawn,
    command: input.command,
    args: input.args,
    cwd: settings.projectRoot,
    originPid: input.originPid,
    timeoutMs: input.timeoutMs,
    maxBytes: input.maxBytes,
  });
  if (!outcome.ok) return { ok: false, reason: "command_failed", detail: outcome.detail };

  // filterOutput redacts its `raw` input unconditionally as its first step
  // (BB5) — no separate policy.redact call (§3.6). The filter budget is clamped
  // to the ceiling; the value came from a validated session record.
  const maxReturnedBytes =
    settings.maxReturnedBytes !== undefined
      ? Math.min(settings.maxReturnedBytes, MAX_RETURNED_CEILING)
      : undefined;
  const filtered = filterOutput({
    raw: outcome.capture.raw,
    intent: input.intent,
    mode: settings.mode,
    ...(maxReturnedBytes !== undefined ? { maxReturnedBytes } : {}),
    source: { kind: "command", command: input.command, args: input.args },
  });

  const warnings = filtered.warnings ?? [];
  const redacted = warnings.some((w) => w.startsWith("redacted"));
  const secretsRedacted = redactedCount(warnings);

  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;

  // On a forced termination the partial output is still processed; surface the
  // cause both as a warning (alongside any redaction warning) and the typed
  // `terminated` field (§3.5).
  const resultWarnings =
    outcome.capture.terminated !== undefined
      ? [...warnings, `terminated: ${outcome.capture.terminated}`]
      : warnings;
  const result: ExecResult = {
    ...filtered,
    ...(resultWarnings.length > 0 ? { warnings: resultWarnings } : {}),
    childExitCode: outcome.capture.childExitCode,
    ...(outcome.capture.terminated !== undefined ? { terminated: outcome.capture.terminated } : {}),
  };

  if (settings.storeRawOutput) {
    const chunkSetId = newId();
    const chunkSet: ChunkSet = {
      chunkSetId,
      sessionId: input.sessionId,
      projectId: settings.projectId,
      createdAt: now(),
      source: { kind: "command", command: input.command, args: input.args },
      rawBytes: filtered.rawBytes,
      redacted,
      chunks: filtered.excerpts.map((e, i) => ({
        id: String(i),
        startLine: e.startLine,
        endLine: e.endLine,
        bytes: Buffer.byteLength(e.text, "utf8"),
        text: e.text,
      })),
    };
    try {
      await saveChunkSet({ storeRoot: input.storeRoot, chunkSet });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
    }
    result.chunkSetId = chunkSetId;
  }

  const event: TokenSaverEvent = {
    id: newId(),
    sessionId: input.sessionId,
    projectId: settings.projectId,
    createdAt: now(),
    sourceKind: "command",
    label: [input.command, ...input.args].join(" "),
    rawBytes: filtered.rawBytes,
    returnedBytes: filtered.returnedBytes,
    bytesSaved: filtered.bytesSaved,
    savingRatio: filtered.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filtered.summary,
    mode: settings.mode,
  };
  try {
    appendEvent({
      store: { root: input.storeRoot },
      event,
      secretsRedacted,
      chunksStored: filtered.excerpts.length,
    });
  } catch (err) {
    return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
  }

  return { ok: true, result };
}

// The filter warning shape is "redacted N secret(s) before processing"; pull N
// back out for the stats event's secretsRedacted total.
function redactedCount(warnings: readonly string[]): number {
  for (const w of warnings) {
    const m = /^redacted (\d+) secret/.exec(w);
    if (m?.[1] !== undefined) return Number(m[1]);
  }
  return 0;
}
