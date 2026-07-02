import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type ReplayTrace, readReplayTraces } from "@megasaver/output-filter";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

export type SeamArmSummary = {
  traces: number;
  failureBoostFired: number;
  memoryBoostFired: number;
  meanFailureBoostFired: number;
  meanMemoryBoostFired: number;
  rawTokens: number;
  returnedTokens: number;
};

export type SeamSummary = {
  traces: number;
  seamOn: SeamArmSummary;
  seamOff: SeamArmSummary;
};

function summarizeArm(traces: readonly ReplayTrace[]): SeamArmSummary {
  let failureBoostFired = 0;
  let memoryBoostFired = 0;
  let rawTokens = 0;
  let returnedTokens = 0;
  const firedFailureBoosts: number[] = [];
  const firedMemoryBoosts: number[] = [];

  for (const trace of traces) {
    rawTokens += trace.ranking.rawTokens;
    returnedTokens += trace.ranking.returnedTokens;
    let failureFired = false;
    let memoryFired = false;
    for (const chunk of trace.ranking.candidates) {
      const failure = chunk.engine?.failureHistoryBoost ?? 0;
      const memory = chunk.engine?.memoryBoost ?? 0;
      if (failure > 0) {
        failureFired = true;
        firedFailureBoosts.push(failure);
      }
      if (memory > 0) {
        memoryFired = true;
        firedMemoryBoosts.push(memory);
      }
    }
    if (failureFired) failureBoostFired += 1;
    if (memoryFired) memoryBoostFired += 1;
  }

  const mean = (xs: readonly number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    traces: traces.length,
    failureBoostFired,
    memoryBoostFired,
    meanFailureBoostFired: mean(firedFailureBoosts),
    meanMemoryBoostFired: mean(firedMemoryBoosts),
    rawTokens,
    returnedTokens,
  };
}

export function summarizeSeamTraces(traces: readonly ReplayTrace[]): SeamSummary {
  return {
    traces: traces.length,
    seamOn: summarizeArm(traces.filter((t) => t.ranking.engineRanking)),
    seamOff: summarizeArm(traces.filter((t) => !t.ranking.engineRanking)),
  };
}

const num = (x: number): string => x.toLocaleString("en-US");

function renderArm(label: string, total: number, a: SeamArmSummary): string[] {
  const pct = (n: number, of: number): string => `${((n / of) * 100).toFixed(1)}%`;
  const lines = [
    `seam ${label} arm:`,
    `  traces:                      ${a.traces}/${total} (${pct(a.traces, total)})`,
  ];
  if (a.traces === 0) {
    lines.push("  (no traces in this arm)");
    return lines;
  }
  lines.push(
    `  failure boost fired:         ${a.failureBoostFired}/${a.traces} traces (${pct(a.failureBoostFired, a.traces)})`,
    `  memory boost fired:          ${a.memoryBoostFired}/${a.traces} traces (${pct(a.memoryBoostFired, a.traces)})`,
    `  mean failure boost (fired):  ${a.meanFailureBoostFired.toFixed(3)}`,
    `  mean memory boost (fired):   ${a.meanMemoryBoostFired.toFixed(3)}`,
    `  raw tokens:                  ${num(a.rawTokens)}`,
    `  returned tokens:             ${num(a.returnedTokens)}`,
  );
  return lines;
}

export function renderSeamReport(s: SeamSummary): string[] {
  if (s.traces === 0) {
    return [
      "No seam traces recorded yet.",
      "Set MEGASAVER_SEAM_TRACE=true, then run commands or reads through",
      "`mega output exec` / `mega output filter` for a registry session,",
      "then re-run for a seam effectiveness report.",
    ];
  }
  return [
    `traces analyzed:             ${num(s.traces)}`,
    "",
    ...renderArm("ON", s.traces, s.seamOn),
    "",
    ...renderArm("OFF", s.traces, s.seamOff),
  ];
}

// Trace files live at stats/<projectId>/<sessionId>-traces/replay-traces.jsonl
// (per-session dir; writeReplayTrace owns the fixed filename). Missing dirs or
// files simply mean no traces yet — readReplayTraces tolerates both.
function locateTraceFiles(root: string, projectId: string, sessionId?: string): string[] {
  const statsDir = join(root, "stats", projectId);
  if (sessionId !== undefined) {
    return [join(statsDir, `${sessionId}-traces`, "replay-traces.jsonl")];
  }
  let names: string[];
  try {
    names = readdirSync(statsDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith("-traces"))
    .sort()
    .map((n) => join(statsDir, n, "replay-traces.jsonl"));
}

export type RunAuditSeamInput = {
  projectName: string;
  sessionFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runAuditSeam(input: RunAuditSeamInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let sessionId: string | undefined;
  if (input.sessionFlag !== undefined) {
    const parsedSession = sessionIdSchema.safeParse(input.sessionFlag);
    if (!parsedSession.success) {
      input.stderr(`error: invalid session id "${input.sessionFlag}"`);
      return 1;
    }
    sessionId = parsedSession.data;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const traces = locateTraceFiles(rootDir, project.id, sessionId).flatMap(readReplayTraces);
    const summary = summarizeSeamTraces(traces);
    if (input.json) {
      input.stdout(JSON.stringify(summary));
    } else {
      for (const line of renderSeamReport(summary)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditSeamCommand = defineCommand({
  meta: {
    name: "seam",
    description: "Seam effectiveness report from recorded ranking traces.",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    session: { type: "string", description: "Restrict to one session id." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runAuditSeam({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
