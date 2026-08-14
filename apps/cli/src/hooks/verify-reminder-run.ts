import { type OverlayTokenSaverEvent, readOverlayEvents } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";

export const VERIFY_REMINDER_WINDOW_MINUTES = 30;

const REMINDER =
  "Mega Saver: no exec receipt (command + exit code) was recorded for this session in the " +
  "last 30 minutes. If you claimed test/build results, run the check through `mega output " +
  "exec` or MCP proxy_run_command so the claim carries a receipt (`mega verify claims`).";

export function buildVerifyReminder(input: {
  events: readonly OverlayTokenSaverEvent[];
  nowMs: number;
  windowMinutes: number;
}): string | undefined {
  const floor = input.nowMs - input.windowMinutes * 60_000;
  const hasReceipt = input.events.some((event) => {
    if (event.sourceKind !== "command") return false;
    const ts = Date.parse(event.createdAt);
    return Number.isFinite(ts) && ts >= floor;
  });
  return hasReceipt ? undefined : REMINDER;
}

export async function runVerifyReminderHookFromProcess(deps: {
  storeRoot: string;
  stdin: () => Promise<string>;
  stdout: (line: string) => void;
  nowMs?: () => number;
}): Promise<0> {
  try {
    const payload = JSON.parse(await deps.stdin()) as { session_id?: string; cwd?: string };
    if (typeof payload.session_id !== "string" || payload.session_id === "") return 0;
    // ASSUMPTION (spec Open questions): the Stop payload carries cwd; Claude
    // Code runs hook commands in the project directory, so process.cwd() is
    // the honest fallback.
    const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
    const events = readOverlayEvents(
      { root: deps.storeRoot },
      encodeWorkspaceKey(cwd),
      payload.session_id,
    );
    const reminder = buildVerifyReminder({
      events,
      nowMs: (deps.nowMs ?? Date.now)(),
      windowMinutes: VERIFY_REMINDER_WINDOW_MINUTES,
    });
    if (reminder !== undefined) {
      // ASSUMPTION (spec Open questions): Claude Code accepts
      // hookSpecificOutput.additionalContext on Stop; if verification at impl
      // time says otherwise, fall back to { systemMessage: reminder }.
      // Warn-only either way — NEVER decision:"block".
      deps.stdout(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "Stop", additionalContext: reminder },
        }),
      );
    }
  } catch {
    // fail-open: a reminder must never break the session's Stop.
  }
  return 0;
}
