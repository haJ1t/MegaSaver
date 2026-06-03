import type { KnownAgentId, McpStatusResult } from "@megasaver/mcp-bridge";
import { McpSetupError, handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { MEGA_MCP_TARGET_BODY, MEGA_MCP_UNINSTALL_BODY, zodErrorMessage } from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";

// The McpSetupOps facade + McpStatusResult type are owned + exported by BB8
// (@megasaver/mcp-bridge); RouteContext.mcpOps carries an injected instance.
// BB11 does NOT redefine them — see route-context.ts import.

async function parseBody<T>(
  ctx: RouteContext,
  schema: {
    safeParse(
      v: unknown,
    ): { success: true; data: T } | { success: false; error: import("zod").ZodError };
  },
): Promise<T | null> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return null;
  }
  return parsed.data;
}

// Execute a setup op and serialise its snapshot. A thrown op failure is
// remapped to McpSetupError so error-mapping surfaces mcp_setup_failed (a
// validation rejection has already responded before reaching here).
async function runOp(ctx: RouteContext, op: () => Promise<McpStatusResult>): Promise<void> {
  try {
    ctx.sendJson(ctx.res, 200, await op(), ctx.origin);
  } catch (err) {
    handleCaughtError(
      ctx.res,
      ctx.origin,
      err instanceof McpSetupError
        ? err
        : new McpSetupError(err instanceof Error ? err.message : String(err), { cause: err }),
      ctx.sendError,
    );
  }
}

export async function handleMcpStatus(ctx: RouteContext): Promise<void> {
  await runOp(ctx, () => ctx.mcpOps.status());
}

export async function handleMcpInstall(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: KnownAgentId; project: string }>(
    ctx,
    MEGA_MCP_TARGET_BODY,
  );
  if (data === null) return;
  await runOp(ctx, () => ctx.mcpOps.install(data.target, data.project));
}

export async function handleMcpRepair(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: KnownAgentId; project: string }>(
    ctx,
    MEGA_MCP_TARGET_BODY,
  );
  if (data === null) return;
  await runOp(ctx, () => ctx.mcpOps.repair(data.target, data.project));
}

export async function handleMcpUninstall(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: KnownAgentId }>(ctx, MEGA_MCP_UNINSTALL_BODY);
  if (data === null) return;
  await runOp(ctx, () => ctx.mcpOps.uninstall(data.target));
}

const MCP_PATH = /^\/api\/mcp\/(status|install|repair|uninstall)$/;

export async function dispatchMcpSetup(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): Promise<boolean> {
  const match = path.match(MCP_PATH);
  if (!match) return false;
  const segment = match[1];

  const guard = (expected: string): boolean => {
    if (method === expected) return true;
    onMethodNotAllowed();
    return false;
  };

  if (segment === "status") {
    if (guard("GET")) await handleMcpStatus(ctx);
    return true;
  }
  if (segment === "install") {
    if (guard("POST")) await handleMcpInstall(ctx);
    return true;
  }
  if (segment === "repair") {
    if (guard("POST")) await handleMcpRepair(ctx);
    return true;
  }
  if (segment === "uninstall") {
    if (guard("POST")) await handleMcpUninstall(ctx);
    return true;
  }
  return false;
}
