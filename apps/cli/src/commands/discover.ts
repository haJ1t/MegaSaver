import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { nodeResolverDeps, resolveWorkspaceTokenSaverSettings } from "@megasaver/context-gate";
import {
  DISCOVER_HOOK_MISSING_HINT,
  type ExposureGroup,
  type ExposureReport,
  parseHookLogRows,
  readWorkspaceOverlayEvents,
  scanExposure,
} from "@megasaver/core";
import { type TokenSaverMode, encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
import { HOOK_LOG_RELATIVE_PATH } from "../hooks/logger.js";
import { isSaverCoveredTool, minBytesFor } from "../hooks/saver.js";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type RunDiscoverInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  hookLogPath?: string;
  resolveActivation?: (
    storeRoot: string,
    cwd: string,
  ) => { enabled: boolean; mode: TokenSaverMode } | null;
  now?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

// Unreadable log is treated as absent — adoption-only (hooks/status.ts).
function readHookLog(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// stat only, never open: a failed stat or a directory moves the call to
// unmeasured — a directory size is never a proxy for output size.
function sizeOf(filePath: string): number | undefined {
  try {
    const s = statSync(filePath);
    return s.isFile() ? s.size : undefined;
  } catch {
    return undefined;
  }
}

function defaultResolveActivation(
  storeRoot: string,
  cwd: string,
): { enabled: boolean; mode: TokenSaverMode } | null {
  const r = resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps());
  return r.enabled ? { enabled: true, mode: r.mode } : null;
}

export type CollectExposureInput = {
  storeRoot: string;
  cwd: string;
  hookLogPath?: string;
  resolveActivation?: RunDiscoverInput["resolveActivation"];
};

// The whole scan pipeline after store resolution — shared by `mega discover`
// and the Task 5 install nudge.
export function collectExposureReport(input: CollectExposureInput): ExposureReport {
  const hookLogPath = input.hookLogPath ?? join(input.cwd, HOOK_LOG_RELATIVE_PATH);
  const content = readHookLog(hookLogPath);
  const rows = content === null ? [] : parseHookLogRows(content);
  const activation = (input.resolveActivation ?? defaultResolveActivation)(
    input.storeRoot,
    input.cwd,
  );
  const mode = activation?.enabled === true ? activation.mode : null;

  let mediatedEvents: Parameters<typeof scanExposure>[0]["mediatedEvents"] = [];
  try {
    mediatedEvents = readWorkspaceOverlayEvents(
      { root: input.storeRoot },
      encodeWorkspaceKey(input.cwd),
    );
  } catch {
    // No stats tree yet — mediated context is simply empty.
  }

  return scanExposure({
    hookLogPresent: content !== null,
    rows,
    activation,
    floorFor: (tool) => minBytesFor(tool, mode ?? "safe"),
    coveredTool: isSaverCoveredTool,
    sizeOf,
    mediatedEvents,
  });
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// Spec JSON contract: renderer-only fields stripped; measuredBytes null for
// count-only groups; hookMissing keeps "no log" distinct from "no exposure".
export function toDiscoverJson(
  report: ExposureReport,
  now: () => string = () => new Date().toISOString(),
): string {
  const group = (g: ExposureGroup) => ({
    cause: g.cause,
    calls: g.calls,
    measuredBytes: g.measuredCalls === 0 ? null : g.measuredBytes,
    uniqueFiles: g.uniqueFiles,
    topFiles: g.topFiles,
    remediation: g.remediation,
    ...(g.caveat !== null ? { caveat: g.caveat } : {}),
  });
  return JSON.stringify({
    window: report.window,
    hookMissing: !report.hookLogPresent,
    groups: report.groups.map(group),
    aboveFloor: report.aboveFloor,
    mediated: report.mediated,
    generatedAt: now(),
  });
}

function foldLine(
  prefix: string,
  fold: { calls: number; rawBytes: number; returnedBytes: number },
): string {
  return `${prefix}: ${fold.calls} calls, ${fold.rawBytes} B raw -> ${fold.returnedBytes} B delivered`;
}

export function renderReport(report: ExposureReport): string[] {
  if (!report.hookLogPresent) return [report.hint ?? DISCOVER_HOOK_MISSING_HINT];
  const lines = ["Unfiltered exposure (measured bytes only — no counterfactuals):"];
  lines.push(`  saver: ${report.saverEnabled ? `enabled (${report.mode})` : "disabled"}`);
  if (report.window !== null) {
    lines.push(`  window: ${report.window.from} -> ${report.window.to}`);
  }
  for (const [i, g] of report.groups.entries()) {
    const unmeasured =
      g.unmeasuredCalls > 0 ? `, ${plural(g.unmeasuredCalls, "call")} unmeasured` : "";
    lines.push(
      `  ${i + 1}. ${g.cause.replace(/_/g, " ")} — ${plural(g.calls, "call")}, ${g.measuredBytes} B measured across ${plural(g.uniqueFiles, "file")} (est. ~${g.estTokens} tokens)${unmeasured}`,
    );
    lines.push(g.remediation === null ? "     fix: none" : `     fix: ${g.remediation}`);
    if (g.caveat !== null) lines.push(`     note: ${g.caveat}`);
    if (g.topFiles.length > 0) {
      lines.push("     top repeated reads:");
      for (const f of g.topFiles) {
        lines.push(`       ${f.filePath} — ${plural(f.calls, "call")}, ${f.measuredBytes} B`);
      }
    }
  }
  if (report.groups.length === 0) lines.push("  (no exposure found)");
  if (report.aboveFloor !== null) {
    lines.push(
      `  above floor (saver-attempted, not exposure): ${plural(report.aboveFloor.calls, "call")}, ${report.aboveFloor.measuredBytes} B measured`,
    );
  }
  lines.push("  mediated in window:");
  const er = report.mediated.execRewrite;
  const pt = report.mediated.postToolUse;
  if (er === null && pt === null) {
    lines.push("    (no mediated events in the observed window)");
  } else {
    if (er !== null) lines.push(`    ${foldLine("exec-rewrite", er)}`);
    if (pt !== null) lines.push(`    ${foldLine("postToolUse", pt)}`);
  }
  if (report.unmeasuredCalls > 0) {
    lines.push(`  no size evidence: ${plural(report.unmeasuredCalls, "call")} (not estimated)`);
  }
  return lines;
}

export async function runDiscover(input: RunDiscoverInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    // The only failure path, mirroring runHooksStatus (hooks/status.ts).
    storeRoot = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const report = collectExposureReport({
    storeRoot,
    cwd: input.cwd,
    ...(input.hookLogPath !== undefined ? { hookLogPath: input.hookLogPath } : {}),
    ...(input.resolveActivation !== undefined
      ? { resolveActivation: input.resolveActivation }
      : {}),
  });

  if (input.json) {
    input.stdout(toDiscoverJson(report, input.now));
    return 0;
  }
  for (const line of renderReport(report)) input.stdout(line);
  return 0;
}

export const discoverCommand = defineCommand({
  meta: {
    name: "discover",
    description:
      "Report measured unfiltered exposure: tool outputs that bypassed the saver, grouped by cause (read-only).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
    "hook-log": { type: "string", description: "Override Claude Code hook log path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runDiscover({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ...(typeof args["hook-log"] === "string" ? { hookLogPath: args["hook-log"] } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

export function buildExposureNudgeLines(report: ExposureReport, max = 3): string[] {
  return report.groups.slice(0, max).map((g) => {
    const size = g.measuredBytes > 0 ? `, ${g.measuredBytes} B measured` : "";
    const fix =
      g.remediation === null ? "no fix command — see mega discover" : `fix: ${g.remediation}`;
    return `exposure: ${g.cause.replace(/_/g, " ")} — ${plural(g.calls, "call")}${size} (${fix})`;
  });
}
