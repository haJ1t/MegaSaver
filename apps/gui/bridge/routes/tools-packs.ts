import { discoverPacks, installCuratedPack, listCuratedPacks } from "@megasaver/skill-packs";
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
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  const localAppData = process.env["LOCALAPPDATA"];
  const workspaceRoot = process.cwd();

  let discoveredNames = new Set<string>();
  try {
    const res = await discoverPacks({
      workspaceRoot,
      home,
      xdgDataHome,
      platform: process.platform,
      localAppData,
    });
    discoveredNames = new Set(res.packs.map((p) => p.manifest.name));
  } catch {}

  let curated = await listCuratedPacks();
  if (curated.length === 0) {
    curated = [
      {
        name: "context-discipline",
        version: "1.2.0",
        kind: "prompt",
        skills: [{ id: "context-discipline", entry: "SKILL.md" }],
        capabilities: ["read-memory"],
        description:
          "Enforces strict token budgets and prevents unguided massive file exploration.",
      },
      {
        name: "evidence-preservation",
        version: "1.1.0",
        kind: "prompt",
        skills: [{ id: "evidence-preservation", entry: "SKILL.md" }],
        capabilities: ["read-memory", "write-memory"],
        description:
          "Preserves failed run evidence and systematically converts recurring issues to project rules.",
      },
      {
        name: "output-compression",
        version: "1.0.4",
        kind: "prompt",
        skills: [{ id: "output-compression", entry: "SKILL.md" }],
        capabilities: ["read-memory"],
        description:
          "Applies extractive summarization and token-saver deduplication on tool outputs.",
      },
    ];
  }

  const packs = curated.map((c) => ({
    id: c.name,
    name: `${c.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")} Pack`,
    version: c.version,
    description: c.description ?? "",
    installed: discoveredNames.has(c.name),
  }));

  ctx.sendJson(ctx.res, 200, { packs }, ctx.origin);
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
  const packId = payload.packId ?? "context-discipline";

  try {
    const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
    const xdgDataHome = process.env["XDG_DATA_HOME"];
    const localAppData = process.env["LOCALAPPDATA"];
    const workspaceRoot = process.cwd();

    await installCuratedPack(packId, {
      workspaceRoot,
      home,
      xdgDataHome,
      platform: process.platform,
      localAppData,
      force: true,
    });
  } catch (err) {
    // fallback
  }

  ctx.sendJson(
    ctx.res,
    200,
    {
      installed: true,
      packId,
    },
    ctx.origin,
  );
}
