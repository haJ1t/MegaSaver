import { encodeWorkspaceKey, workspaceLabel } from "@megasaver/shared";
import { z } from "zod";
import type { RouteContext } from "../route-context.js";
import { addUserProject, readUserProjects, removeUserProject } from "../user-projects-store.js";
import { readJsonBody } from "./_body.js";

const postSchema = z.object({ path: z.string().min(1) });

export async function handleGetUserProjects(ctx: RouteContext): Promise<void> {
  const paths = await readUserProjects(ctx.storeRoot);
  const workspaces = paths.map((cwd) => ({
    key: encodeWorkspaceKey(cwd),
    cwd,
    label: workspaceLabel(cwd),
  }));
  ctx.sendJson(ctx.res, 200, { paths, workspaces }, ctx.origin);
}

export async function handlePostUserProjects(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON", ctx.origin);
    return;
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      "Invalid path",
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  try {
    const next = await addUserProject(ctx.storeRoot, parsed.data.path);
    const workspaces = next.map((cwd) => ({
      key: encodeWorkspaceKey(cwd),
      cwd,
      label: workspaceLabel(cwd),
    }));
    ctx.sendJson(ctx.res, 200, { paths: next, workspaces }, ctx.origin);
  } catch (e) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      e instanceof Error ? e.message : "Invalid path",
      ctx.origin,
    );
  }
}

export async function handleDeleteUserProjects(ctx: RouteContext): Promise<void> {
  let pathValue = ctx.query.get("path") ?? "";
  if (!pathValue) {
    try {
      const body = (await readJsonBody(ctx.req)) as { path?: unknown };
      if (typeof body?.path === "string") pathValue = body.path;
    } catch {
      // ignore body parse failure; will surface as validation error below
    }
  }
  if (!pathValue || pathValue.trim().length === 0) {
    ctx.sendError(ctx.res, 400, "validation_failed", "path required", ctx.origin);
    return;
  }
  try {
    const next = await removeUserProject(ctx.storeRoot, pathValue);
    const workspaces = next.map((cwd) => ({
      key: encodeWorkspaceKey(cwd),
      cwd,
      label: workspaceLabel(cwd),
    }));
    ctx.sendJson(ctx.res, 200, { paths: next, workspaces }, ctx.origin);
  } catch (e) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      e instanceof Error ? e.message : "Invalid path",
      ctx.origin,
    );
  }
}
