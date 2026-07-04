import {
  type DecisionOutput,
  type SessionDecisionTrace,
  readSessionDecisionTrace,
} from "@megasaver/output-filter";
import { sessionIdSchema, workspaceKeySchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

// A workspaceKey that matches no evidence dir, used when the operator did not
// supply --workspace. The reader's evidence join then degrades to
// evidencePresent:false and we print an honest note rather than rendering
// memory/redaction as "none". 16 hex chars keeps it valid for the reader path.
const UNRESOLVED_WORKSPACE_KEY = "0".repeat(16);

const EVIDENCE_NOT_RESOLVED_NOTE =
  "note: evidence workspace not resolved — pass --workspace <key> to include memory/redaction";

export type RunTraceExplainInput = {
  sessionId: string;
  projectName: string;
  workspaceFlag: string | undefined;
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

const n = (x: number): string => x.toFixed(2);

function renderOutput(o: DecisionOutput): string[] {
  const memory =
    o.memory && o.memory.rankedByMemoryIds.length > 0 ? o.memory.rankedByMemoryIds.join(", ") : "—";
  const redaction = o.redaction?.redacted ? `yes (${o.redaction.highRiskFindings} high-risk)` : "—";
  const lines = [
    `${o.toolName} → decision=${o.decision} | memory: ${memory} | redaction: ${redaction}`,
  ];
  for (const c of o.selected) {
    lines.push(
      `  lines ${c.startLine}-${c.endLine}  score=${n(c.engine.finalScore)}  base/mem/fail=${n(
        c.engine.baseRelevance,
      )}/${n(c.engine.memoryBoost)}/${n(c.engine.failureHistoryBoost)}`,
    );
  }
  if (o.omitted.length > 0) lines.push(`  (${o.omitted.length} omitted)`);
  return lines;
}

export function renderDecisionTrace(
  trace: SessionDecisionTrace,
  workspaceResolved: boolean,
): string[] {
  if (trace.outputs.length === 0) {
    return [
      "No decision traces for this session yet.",
      "Tracing is on by default (disable via MEGASAVER_SEAM_TRACE=false).",
    ];
  }
  const lines: string[] = [];
  // Real traces carry memory/redaction inline, independent of --workspace. Only
  // the vestigial evidence-only fallback needs --workspace; print the note just
  // when it would genuinely add missing data (no inline data present), else it
  // contradicts the rendered memory/redaction.
  const anyInline = trace.outputs.some((o) => o.memory !== null || o.redaction !== null);
  const showNote = !workspaceResolved && !anyInline;
  if (showNote) lines.push(EVIDENCE_NOT_RESOLVED_NOTE, "");
  for (const o of trace.outputs) lines.push(...renderOutput(o));
  return lines;
}

export async function runTraceExplain(input: RunTraceExplainInput): Promise<0 | 1> {
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

  const parsedSession = sessionIdSchema.safeParse(input.sessionId);
  if (!parsedSession.success) {
    input.stderr(`error: invalid session id "${input.sessionId}"`);
    return 1;
  }
  const sessionId = parsedSession.data;

  let workspaceKey = UNRESOLVED_WORKSPACE_KEY;
  let workspaceResolved = false;
  if (input.workspaceFlag !== undefined) {
    const parsedWorkspace = workspaceKeySchema.safeParse(input.workspaceFlag);
    if (!parsedWorkspace.success) {
      input.stderr(`error: invalid workspace key "${input.workspaceFlag}"`);
      return 1;
    }
    workspaceKey = parsedWorkspace.data;
    workspaceResolved = true;
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
    const trace = readSessionDecisionTrace(
      { root: rootDir },
      { projectId: project.id, sessionId, workspaceKey },
    );
    if (input.json) {
      input.stdout(JSON.stringify(trace));
    } else {
      for (const line of renderDecisionTrace(trace, workspaceResolved)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const traceExplainCommand = defineCommand({
  meta: {
    name: "explain",
    description:
      "Explain a session's recorded decision chain (ranking + memory attribution + redaction).",
  },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id to explain." },
    project: { type: "string", required: true, description: "Project name." },
    workspace: {
      type: "string",
      description: "Workspace key (16 hex) to join evidence; omit to skip memory/redaction.",
    },
    store: { type: "string", description: "Override store directory." },
    json: {
      type: "boolean",
      default: false,
      description: "Emit the SessionDecisionTrace as JSON.",
    },
  },
  async run({ args }) {
    const code = await runTraceExplain({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      projectName: typeof args.project === "string" ? args.project : "",
      workspaceFlag: typeof args.workspace === "string" ? args.workspace : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
