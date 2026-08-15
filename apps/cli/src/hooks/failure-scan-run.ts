import { type OverlayTokenSaverEvent, readOverlayEvents } from "@megasaver/core";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { unresolvedFailingReceipts } from "../commands/failures/detectors.js";

export const FAILURE_SCAN_WINDOW_MINUTES = 30;

function redactedLabel(event: OverlayTokenSaverEvent): string {
  return redact(event.label).redacted;
}

export function buildFailureScanWarning(input: {
  events: readonly OverlayTokenSaverEvent[];
  nowMs: number;
  windowMinutes: number;
}): string | undefined {
  const unresolved = unresolvedFailingReceipts(input.events, {
    windowMinutes: input.windowMinutes,
    nowMs: input.nowMs,
  });
  if (unresolved.length === 0) return undefined;
  const count = unresolved.length;
  const first = unresolved[0];
  const label = first === undefined ? "" : redactedLabel(first);
  const plural = count === 1 ? "" : "s";
  return `Mega Saver: ${count} unacknowledged failing command${plural} in the last ${input.windowMinutes} minutes (first: ${label}). Re-run the failing check through \`mega output exec\` so its result carries a receipt.`;
}
export async function runFailureScanHookFromProcess(deps: {
  storeRoot: string;
  stdin: () => Promise<string>;
  stdout: (line: string) => void;
  nowMs?: () => number;
}): Promise<0> {
  try {
    const payload = JSON.parse(await deps.stdin()) as { session_id?: string; cwd?: string };
    if (typeof payload.session_id !== "string" || payload.session_id === "") return 0;
    const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
    const events = readOverlayEvents(
      { root: deps.storeRoot },
      encodeWorkspaceKey(cwd),
      payload.session_id,
    );
    const warning = buildFailureScanWarning({
      events,
      nowMs: (deps.nowMs ?? Date.now)(),
      windowMinutes: FAILURE_SCAN_WINDOW_MINUTES,
    });
    if (warning !== undefined) {
      deps.stdout(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "Stop", additionalContext: warning },
        }),
      );
    }
  } catch {
    // fail-open: a reminder must never break the session's Stop.
  }
  return 0;
}
