import type { RouteContext } from "../route-context.js";

export type ProjectListItem = {
  id: string;
  name: string;
  rootPath: string;
};

export async function handleListProjects(ctx: RouteContext): Promise<void> {
  const projects =
    ctx.registry?.listProjects().map((p) => ({
      id: p.id,
      name: p.name,
      rootPath: p.rootPath,
    })) ?? [];
  ctx.sendJson(ctx.res, 200, projects, ctx.origin);
}
