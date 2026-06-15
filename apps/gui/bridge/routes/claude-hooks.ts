import {
  installClaudeCodeHook,
  readClaudeCodeHookStatus,
  uninstallClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";

const HOOKS_PATH = /^\/api\/hooks\/claude-code$/;

export async function dispatchClaudeHooks(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): Promise<boolean> {
  if (!HOOKS_PATH.test(path)) return false;
  try {
    if (method === "GET") {
      const status = readClaudeCodeHookStatus({ settingsPath: ctx.claudeSettingsPath });
      ctx.sendJson(ctx.res, 200, status, ctx.origin);
      return true;
    }
    if (method === "POST") {
      installClaudeCodeHook({ settingsPath: ctx.claudeSettingsPath });
      ctx.sendJson(
        ctx.res,
        200,
        readClaudeCodeHookStatus({ settingsPath: ctx.claudeSettingsPath }),
        ctx.origin,
      );
      return true;
    }
    if (method === "DELETE") {
      uninstallClaudeCodeHook({ settingsPath: ctx.claudeSettingsPath });
      ctx.sendJson(
        ctx.res,
        200,
        readClaudeCodeHookStatus({ settingsPath: ctx.claudeSettingsPath }),
        ctx.origin,
      );
      return true;
    }
    onMethodNotAllowed();
    return true;
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
    return true;
  }
}
