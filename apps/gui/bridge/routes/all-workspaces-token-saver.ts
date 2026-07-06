import { type StatsStore, readAllWorkspaceTokenSaverTotals } from "@megasaver/stats";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";

function statsStore(ctx: RouteContext): StatsStore {
  return { root: ctx.storeRoot };
}

// Cumulative token-saver totals across every workspace — the source for the GUI
// home headline. The bridge returns raw totals; the client computes the $/context
// headline so the price const lives once in @megasaver/stats, shared with the CLI.
export async function handleAllWorkspacesTokenSaverStats(ctx: RouteContext): Promise<void> {
  try {
    const totals = readAllWorkspaceTokenSaverTotals(statsStore(ctx));
    ctx.sendJson(ctx.res, 200, totals, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
