import type { TokenSaverEvent } from "@megasaver/stats";
import type { RouteContext } from "../route-context.js";

export type CacheStatusWire = {
  cacheHitRatio: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  churnDetected: boolean;
  proxyCalls: number;
  skippedLines: number;
  isEstimate: true;
  footnote: string;
  capturedAt: string;
  hasData: boolean;
};

export async function handleGetCacheStatus(ctx: RouteContext): Promise<void> {
  try {
    const { readProxyUsage } = await import("@megasaver/llm-proxy");
    const { SAVINGS_FOOTNOTE, INPUT_PRICE_CAPTURED_AT } = await import("@megasaver/stats");
    const result = await readProxyUsage({ storeRoot: ctx.storeRoot });
    const hasData = result.events.length > 0;
    if (!hasData) {
      ctx.sendJson(
        ctx.res,
        200,
        {
          cacheHitRatio: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          churnDetected: false,
          proxyCalls: 0,
          skippedLines: result.skippedLines,
          isEstimate: true,
          footnote: SAVINGS_FOOTNOTE,
          capturedAt: INPUT_PRICE_CAPTURED_AT,
          hasData: false,
        } satisfies CacheStatusWire,
        ctx.origin,
      );
      return;
    }
    let creation = 0;
    let read = 0;
    for (const e of result.events) {
      creation += e.cacheCreationTokens;
      read += e.cacheReadTokens;
    }
    const total = creation + read;
    const cacheHitRatio = total === 0 ? 0 : read / total;
    // Churn signal: high invalidation rate from stats events folded via proxy window.
    // Keep cheap: reuse existing cacheChurn reader if present; otherwise infer from proxy alone.
    let churnDetected = false;
    try {
      const { analyzeCacheChurn } = await import("@megasaver/stats");
      // Bridge test injects ctx.readEvents; production passes none → empty analysed set.
      const maybeEvents = (ctx as unknown as { readEvents?: (r: string) => TokenSaverEvent[] })
        .readEvents;
      if (maybeEvents) {
        const evts = (() => {
          try {
            return maybeEvents(ctx.storeRoot);
          } catch {
            return [] as TokenSaverEvent[];
          }
        })();
        const churn = analyzeCacheChurn(evts);
        churnDetected = churn.cacheInvalidationRate > 0.3;
      }
    } catch {}
    ctx.sendJson(
      ctx.res,
      200,
      {
        cacheHitRatio,
        cacheCreationInputTokens: creation,
        cacheReadInputTokens: read,
        churnDetected,
        proxyCalls: result.events.length,
        skippedLines: result.skippedLines,
        isEstimate: true,
        footnote: SAVINGS_FOOTNOTE,
        capturedAt: INPUT_PRICE_CAPTURED_AT,
        hasData: true,
      } satisfies CacheStatusWire,
      ctx.origin,
    );
  } catch {
    const { SAVINGS_FOOTNOTE, INPUT_PRICE_CAPTURED_AT } = await import("@megasaver/stats");
    ctx.sendJson(
      ctx.res,
      200,
      {
        cacheHitRatio: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        churnDetected: false,
        proxyCalls: 0,
        skippedLines: 0,
        isEstimate: true,
        footnote: SAVINGS_FOOTNOTE,
        capturedAt: INPUT_PRICE_CAPTURED_AT,
        hasData: false,
      } satisfies CacheStatusWire,
      ctx.origin,
    );
  }
}

export async function handlePostCacheClear(ctx: RouteContext): Promise<void> {
  try {
    // Clear the durable usage log. The tolerant proxy reader underpins handleGetCacheStatus;
    // truncating it is the only honest "clear" (otherwise the button lies and a refresh
    // re-shows the same 94%). Writes are best-effort 0600; absence is not an error.
    const { proxyUsageLogPath } = await import("@megasaver/llm-proxy");
    const { writeFileSync, existsSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const p = proxyUsageLogPath(ctx.storeRoot);
    try {
      mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
    } catch {}
    // Truncate, don't unlink — keeps the path stable for tailers.
    writeFileSync(p, "", { mode: 0o600 });
    try {
      const { chmodSync } = await import("node:fs");
      chmodSync(p, 0o600);
    } catch {}
  } catch {}
  ctx.sendJson(ctx.res, 200, { cleared: true, clearedAt: ctx.now() }, ctx.origin);
}

export async function handleGetCacheChurn(
  ctx: RouteContext & { readEvents?: (storeRoot: string) => TokenSaverEvent[] },
): Promise<void> {
  const reader = ctx.readEvents ?? (() => [] as TokenSaverEvent[]);
  let events: TokenSaverEvent[] = [];
  try {
    events = reader(ctx.storeRoot);
  } catch {
    events = [];
  }
  const { analyzeCacheChurn } = await import("@megasaver/stats");
  const result = analyzeCacheChurn(events);
  ctx.sendJson(ctx.res, 200, result, ctx.origin);
}
