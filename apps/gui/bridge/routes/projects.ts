import { constants, accessSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { CREATE_PROJECT_BODY, zodErrorMessage } from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";

export function handleGetProjects(ctx: RouteContext): void {
  try {
    const projects = ctx.registry
      .listProjects()
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    ctx.sendJson(ctx.res, 200, projects, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

// rootPath validation (P0, §5): an existing + directory + readable path. NOT
// writability — project create only records the root; filesystem-mutating ops
// (connector sync, index build) do their own writability check later.
function rootPathError(rootPath: string): string | null {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(rootPath);
  } catch {
    return `Root path does not exist: ${rootPath}`;
  }
  if (!stat.isDirectory()) return `Root path is not a directory: ${rootPath}`;
  try {
    accessSync(rootPath, constants.R_OK);
  } catch {
    return `Root path is not readable: ${rootPath}`;
  }
  return null;
}

export async function handlePostProject(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = CREATE_PROJECT_BODY.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  // Resolve relative roots against the bridge cwd, but the form is expected to
  // send an absolute path — we never assume the bridge cwd IS the project.
  const rootPath = resolve(parsed.data.rootPath);
  const fsError = rootPathError(rootPath);
  if (fsError) {
    ctx.sendError(ctx.res, 400, "rootpath_invalid", fsError, ctx.origin);
    return;
  }
  // Core dedupes by id (never by name), so guard duplicate names here to keep
  // the picker unambiguous.
  const duplicate = ctx.registry.listProjects().some((p) => p.name === parsed.data.name);
  if (duplicate) {
    ctx.sendError(
      ctx.res,
      409,
      "validation_failed",
      `A project named "${parsed.data.name}" already exists.`,
      ctx.origin,
    );
    return;
  }
  try {
    const id = projectIdSchema.parse(ctx.newId());
    const createdAt = ctx.now();
    const created = ctx.registry.createProject({
      id,
      name: parsed.data.name,
      rootPath,
      createdAt,
      updatedAt: createdAt,
    });
    ctx.sendJson(ctx.res, 201, created, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
