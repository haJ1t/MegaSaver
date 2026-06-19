import { checkConflicts } from "@megasaver/core";
import { buildGraph } from "@megasaver/memory-graph";
import type { ConflictPair, GraphInput } from "@megasaver/memory-graph";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

export type RunMemoryGraphInput = {
  projectName: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runMemoryGraph(input: RunMemoryGraphInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
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

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
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

    const sessions = registry.listSessions(project.id);
    const memories = registry.listMemoryEntries(project.id);

    // Approved+active entries are the baseline for conflict detection.
    const approvedActive = memories.filter((m) => m.approval === "approved" && !m.stale);

    // Build conflict pairs by running checkConflicts for each candidate against
    // the approved-active set (excluding the candidate itself).
    const conflicts: ConflictPair[] = [];
    for (const candidate of memories) {
      const baseline = approvedActive.filter((m) => m.id !== candidate.id);
      const result = checkConflicts(candidate, baseline);
      if (result.outcome === "unrelated") continue;
      const kind =
        result.outcome === "duplicate"
          ? "duplicate"
          : result.outcome === "supersession"
            ? "supersede"
            : "conflict";
      for (const conflictId of result.conflictIds) {
        conflicts.push({ from: candidate.id, to: conflictId, kind });
      }
    }

    const graphInput: GraphInput = {
      projects: [{ id: project.id, name: project.name }],
      sessions: sessions.map((s) => ({ id: s.id, projectId: s.projectId })),
      memories: memories.map((m) => ({
        id: m.id,
        scope: m.scope,
        sessionId: m.sessionId,
        projectId: m.projectId,
        memoryType: m.type,
        title: m.title,
        approval: m.approval,
        confidence: m.confidence,
        source: m.source,
        stale: m.stale,
        evidenceIds: m.evidence ?? [],
      })),
      // Evidence and chunkSets are workspace-keyed and handled by the GUI
      // overlay path; the project-scoped CLI view omits them deliberately to
      // keep this command purely project-registry-driven.
      evidence: [],
      chunkSets: [],
      conflicts,
    };

    const graph = buildGraph(graphInput);

    if (input.jsonFlag) {
      input.stdout(JSON.stringify(graph));
    } else {
      input.stdout(`nodes=${graph.stats.nodeCount} edges=${graph.stats.edgeCount}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryGraphCommand = defineCommand({
  meta: { name: "graph", description: "Print the memory graph for a project as JSON." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    store: { type: "string", description: "Override store directory." },
    json: {
      type: "boolean",
      default: false,
      description: "Emit JSON output.",
    },
  },
  async run({ args }) {
    const code = await runMemoryGraph({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
