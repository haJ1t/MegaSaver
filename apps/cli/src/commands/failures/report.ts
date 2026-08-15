import type { DetectorResult } from "./detectors.js";

export type SilentFailureReport = {
  status: "silent-failure-report";
  windowMinutes: number;
  workspaceKey: string;
  liveSessionId: string | null;
  detectors: readonly DetectorResult[];
};

export function renderFailureReport(
  report: SilentFailureReport,
  stdout: (line: string) => void,
): void {
  stdout("Silent-failure report:");
  stdout(`  workspace: ${report.workspaceKey}`);
  stdout(`  session: ${report.liveSessionId ?? "(none)"}  window: ${report.windowMinutes} minutes`);
  stdout("");
  for (const detector of report.detectors) {
    if (detector.verdict === "clear") {
      stdout(`  [${detector.id}] clear`);
      continue;
    }
    if (detector.verdict === "disabled") {
      stdout(`  [${detector.id}] disabled (--no-${flagOf(detector.id)})`);
      continue;
    }
    if (detector.verdict === "no-signal") {
      stdout(`  [${detector.id}] no signal: ${detector.reason ?? "backing store absent"}`);
      continue;
    }
    for (const finding of detector.findings) {
      stdout(`  [${detector.id}] ${finding}`);
    }
    for (const line of detector.info) {
      stdout(`  info: ${line}`);
    }
    if (detector.fix !== undefined) {
      stdout(`  fix: ${detector.fix}`);
    }
  }
}

function flagOf(id: DetectorResult["id"]): string {
  switch (id) {
    case "tool-error":
      return "tool-errors";
    case "context-overflow":
      return "overflow";
    case "partial-completion":
      return "partial";
    case "hallucinated-state":
      return "hallucinated";
  }
}
