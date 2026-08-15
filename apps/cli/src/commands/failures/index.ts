import { readFile } from "node:fs/promises";
import {
  type CliMessage,
  failuresDaysConflictMessage,
  failuresInputTooLargeMessage,
  failuresLiveSessionMessage,
  failuresWindowMessage,
  fileReadFailedMessage,
} from "../../errors.js";
import { type DetectorId, detectSilentFailures } from "./detectors.js";
import { type SilentFailureReport, renderFailureReport } from "./report.js";
import { MAX_FAILURES_INPUT_BYTES } from "./scan-refs.js";
import { loadFailureSnapshot } from "./snapshot.js";

export const DEFAULT_FAILURES_WINDOW_MINUTES = 240;
const LIVE_SESSION_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

export function parseWindowMinutes(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 1440 ? n : null;
}

export type RunAlertsFailuresInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  days?: string; // presence = usage error (--days is Pro-report-only, Decision 1)
  liveSession?: string;
  window?: string;
  file?: string;
  stdinIsTty: boolean;
  readStdin: () => Promise<string>;
  json: boolean;
  strict: boolean;
  toolErrors: boolean;
  overflow: boolean;
  partial: boolean;
  hallucinated: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAlertsFailures(input: RunAlertsFailuresInput): Promise<0 | 1> {
  const fail = (cli: CliMessage): 1 => {
    input.stderr(cli.message);
    return cli.exitCode;
  };

  if (input.days !== undefined) {
    return fail(failuresDaysConflictMessage());
  }

  let windowMinutes = DEFAULT_FAILURES_WINDOW_MINUTES;
  if (input.window !== undefined) {
    const parsed = parseWindowMinutes(input.window);
    if (parsed === null) {
      return fail(failuresWindowMessage(input.window));
    }
    windowMinutes = parsed;
  }

  if (input.liveSession !== undefined && !LIVE_SESSION_PATTERN.test(input.liveSession)) {
    return fail(failuresLiveSessionMessage());
  }

  let inputText: string | undefined;
  if (input.file !== undefined) {
    try {
      inputText = await readFile(input.file, "utf8");
    } catch (err) {
      return fail(fileReadFailedMessage(err instanceof Error ? err.message : String(err)));
    }
  } else if (!input.stdinIsTty) {
    inputText = await input.readStdin();
  }
  if (inputText !== undefined && Buffer.byteLength(inputText, "utf8") > MAX_FAILURES_INPUT_BYTES) {
    return fail(failuresInputTooLargeMessage(MAX_FAILURES_INPUT_BYTES));
  }

  const snapshot = await loadFailureSnapshot({
    storeRoot: input.storeRoot,
    cwd: input.cwd,
    ...(input.liveSession !== undefined ? { liveSessionId: input.liveSession } : {}),
    ...(inputText !== undefined ? { inputText } : {}),
  });

  const enabled: Readonly<Record<DetectorId, boolean>> = {
    "tool-error": input.toolErrors,
    "context-overflow": input.overflow,
    "partial-completion": input.partial,
    "hallucinated-state": input.hallucinated,
  };
  const detectors = detectSilentFailures(snapshot, {
    windowMinutes,
    nowMs: input.now(),
    cwd: input.cwd,
    enabled,
  });

  const report: SilentFailureReport = {
    status: "silent-failure-report",
    windowMinutes,
    workspaceKey: snapshot.workspaceKey,
    liveSessionId: snapshot.liveSessionId ?? null,
    detectors,
  };

  if (input.json) {
    input.stdout(JSON.stringify(report));
  } else {
    renderFailureReport(report, input.stdout);
  }

  if (input.strict) {
    const gateFails = detectors.some((d) => d.verdict === "findings");
    return gateFails ? 1 : 0;
  }
  return 0;
}
