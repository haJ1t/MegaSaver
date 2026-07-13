import {
  type MemoryEntry,
  memoryEntrySchema,
  readySteps,
  saveMemoryWithLineage,
} from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { formatPlanStatus, taskPlanIdSchema } from "./shared.js";

export type RunTaskStatusInput = {
  planIdFlag: string;
  saveSummaryFlag?: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runTaskStatus(input: RunTaskStatusInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let planId: ReturnType<typeof taskPlanIdSchema.parse>;
  try {
    planId = taskPlanIdSchema.parse(input.planIdFlag);
  } catch {
    input.stderr(`error: invalid task plan id "${input.planIdFlag}"`);
    return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const plan = registry.getTaskPlan(planId);
    if (!plan) {
      input.stderr("error: task plan not found");
      return 1;
    }
    const ready = readySteps(plan.steps);

    // Opt-in Phase 1 reuse: save a summary memory ONLY when the plan completed.
    if (input.saveSummaryFlag !== undefined) {
      if (plan.status !== "completed") {
        input.stderr("error: plan not completed; cannot save summary");
        return 1;
      }
      const newId = input.newId ?? (() => crypto.randomUUID());
      const now = input.now ?? (() => new Date().toISOString());
      const ts = readTestEnv("MEGA_TEST_NOW") ?? now();
      const entry: MemoryEntry = memoryEntrySchema.parse({
        id: readTestEnv("MEGA_TEST_MEMORY_ENTRY_ID") ?? newId(),
        projectId: plan.projectId,
        sessionId: null,
        scope: "project",
        type: "decision",
        title: `Completed task: ${plan.task}`,
        content: input.saveSummaryFlag,
        keywords: [],
        confidence: "medium",
        source: "session_summary",
        stale: false,
        createdAt: ts,
        updatedAt: ts,
      });
      // Detection ON (living brain §4.2): summaries are born approved, so the
      // born-approved close ladder applies. This path is lexical-only (no
      // vectors), so only a checkConflicts contradiction can close — and every
      // close is disclosed loudly on stderr with its undo.
      const result = saveMemoryWithLineage(registry, entry, {
        now: () => ts,
        allowImmediateClose: true,
      });
      if (result.supersession?.closed === true) {
        const closedTitle = registry.getMemoryEntry(result.supersession.supersededId)?.title ?? "";
        input.stderr(
          `note: superseded ${result.supersession.supersededId} ("${closedTitle}") — undo: mega memory reopen ${result.supersession.supersededId}`,
        );
      }
      if (result.deduped !== undefined) {
        input.stderr(`note: duplicate of ${result.deduped.existingId} — not written`);
      } else {
        input.stderr(`note: saved summary memory ${result.entry.id}`);
      }
    }

    if (input.json) {
      input.stdout(JSON.stringify({ plan, ready }));
    } else {
      for (const line of formatPlanStatus(plan, ready)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskStatusCommand = defineCommand({
  meta: { name: "status", description: "Show a task plan's status and ready steps." },
  args: {
    planId: { type: "positional", required: true, description: "Task plan id (UUID)." },
    "save-summary": {
      type: "string",
      description: "Save a summary memory (only when the plan is completed).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskStatus({
      planIdFlag: typeof args.planId === "string" ? args.planId : "",
      saveSummaryFlag:
        typeof args["save-summary"] === "string" ? (args["save-summary"] as string) : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
