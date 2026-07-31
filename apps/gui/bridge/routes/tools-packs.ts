import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";

const toolState = {
  allowedTools: ["read_file", "write_file", "grep_search", "list_dir"],
  blockedTools: ["danger_execute"],
};

export async function handleGetToolRouter(ctx: RouteContext): Promise<void> {
  ctx.sendJson(ctx.res, 200, toolState, ctx.origin);
}

export async function handlePostToolRouter(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { allowTool?: string; blockTool?: string };
  if (payload.allowTool) {
    toolState.allowedTools = Array.from(new Set([...toolState.allowedTools, payload.allowTool]));
    toolState.blockedTools = toolState.blockedTools.filter((t) => t !== payload.allowTool);
  }
  if (payload.blockTool) {
    toolState.blockedTools = Array.from(new Set([...toolState.blockedTools, payload.blockTool]));
    toolState.allowedTools = toolState.allowedTools.filter((t) => t !== payload.blockTool);
  }
  ctx.sendJson(ctx.res, 200, toolState, ctx.origin);
}

export async function handleGetSkillPacks(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      packs: [
        { id: "context-discipline", name: "Context Discipline Pack", version: "1.2.0", installed: true },
        { id: "evidence-preservation", name: "Evidence Preservation Pack", version: "1.1.0", installed: true },
        { id: "output-compression", name: "Output Compression Pack", version: "1.0.4", installed: true },
      ],
    },
    ctx.origin,
  );
}

export async function handlePostSkillPackInstall(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { packId?: string };
  ctx.sendJson(
    ctx.res,
    200,
    {
      installed: true,
      packId: payload.packId ?? "custom-pack",
    },
    ctx.origin,
  );
}
