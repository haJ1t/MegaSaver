import {
  type PlannerPriority,
  type PlannerStatus,
  deletePlannerCard,
  readPlannerBoard,
  syncRootTodoFile,
  writePlannerCard,
} from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";

// Local, not imported: handler.ts never exported this (the old import was stale),
// and the identically-named type in @megasaver/daemon belongs to a different
// process boundary. Every sibling route here instead takes a RouteContext and
// returns void via ctx.sendJson; planner is the lone holdout, and converging it
// is a refactor rather than a type fix.
type HandlerResponse = { status: number; json: Record<string, unknown> };

const createCardSchema = z.object({
  cwd: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["backlog", "todo", "in-progress", "review", "done"]).default("backlog"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  tags: z.array(z.string()).optional(),
  assignedAgent: z.string().nullable().optional(),
  content: z.string().optional(),
});

const patchCardSchema = z.object({
  cwd: z.string().min(1),
  id: z.string().min(1),
  title: z.string().optional(),
  status: z.enum(["backlog", "todo", "in-progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  tags: z.array(z.string()).optional(),
  assignedAgent: z.string().nullable().optional(),
  content: z.string().optional(),
});

const deleteCardSchema = z.object({
  cwd: z.string().min(1),
  id: z.string().min(1),
});

export async function handlePlannerRoute(input: {
  method: string;
  pathname: string;
  query: Record<string, string | undefined>;
  body: unknown;
}): Promise<HandlerResponse> {
  const { method, pathname, query, body } = input;

  if (pathname === "/api/planner" && method === "GET") {
    const cwd = query["cwd"];
    if (!cwd) return { status: 400, json: { error: "invalid_cwd" } };
    const board = await readPlannerBoard(cwd, encodeWorkspaceKey(cwd));
    return { status: 200, json: { board } };
  }

  if (pathname === "/api/planner/card" && method === "POST") {
    const parsed = createCardSchema.safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
    // `cwd` is passed positionally and is not part of the card, so it is dropped
    // here. The optional fields are spread conditionally rather than defaulted:
    // under exactOptionalPropertyTypes an explicit `undefined` is the error, and
    // writePlannerCard already applies exactly these defaults itself
    // (service.ts: `input.tags ?? []`, `?? null`, `?? ""`) — re-stating them at the
    // call site would silently diverge the day core changes one.
    const card = await writePlannerCard(parsed.data.cwd, {
      title: parsed.data.title,
      status: parsed.data.status,
      priority: parsed.data.priority,
      ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
      ...(parsed.data.assignedAgent !== undefined
        ? { assignedAgent: parsed.data.assignedAgent }
        : {}),
      ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
    });
    return { status: 200, json: { card } };
  }

  if (pathname === "/api/planner/card" && method === "PATCH") {
    const parsed = patchCardSchema.safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
    const { cwd, id, title, status, priority, ...rest } = parsed.data;
    const board = await readPlannerBoard(cwd, encodeWorkspaceKey(cwd));
    let existingCard: unknown;
    for (const col of board.columns) {
      const match = col.cards.find((c) => c.id === id);
      if (match) {
        existingCard = match;
        break;
      }
    }
    if (!existingCard) return { status: 404, json: { error: "card_not_found" } };

    const ex = existingCard as {
      title: string;
      status: PlannerStatus;
      priority: PlannerPriority;
      tags: string[];
      assignedAgent: string | null;
      content: string;
    };
    const card = await writePlannerCard(cwd, {
      id,
      title: title ?? ex.title,
      status: status ?? ex.status,
      priority: priority ?? ex.priority,
      tags: rest.tags ?? ex.tags,
      assignedAgent: rest.assignedAgent !== undefined ? rest.assignedAgent : ex.assignedAgent,
      content: rest.content ?? ex.content,
    });
    return { status: 200, json: { card } };
  }

  if (pathname === "/api/planner/card" && method === "DELETE") {
    const parsed = deleteCardSchema.safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
    await deletePlannerCard(parsed.data.cwd, parsed.data.id);
    return { status: 200, json: { ok: true } };
  }

  if (pathname === "/api/planner/sync-todo" && method === "POST") {
    const parsed = z.object({ cwd: z.string().min(1) }).safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
    const res = await syncRootTodoFile(parsed.data.cwd);
    return { status: 200, json: res };
  }

  return { status: 404, json: { error: "not_found" } };
}
