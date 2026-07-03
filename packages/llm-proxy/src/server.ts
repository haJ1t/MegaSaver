import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createProxyHandler } from "./proxy-handler.js";
import type { ProxyUsageEvent } from "./usage-event.js";

export type StartProxyOptions = {
  port: number;
  upstreamBaseUrl: string;
  upstreamFetch?: typeof fetch;
  onUsage?: (event: ProxyUsageEvent) => void;
  health?: { capability: string; instanceId: string };
  now?: () => string;
  newId?: () => string;
};

// Hard-coded, not an option: the proxy carries the operator's API key, so it must
// never be exposed beyond loopback. There is deliberately no `host` override.
const LOOPBACK_HOST = "127.0.0.1";

export type RunningProxy = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export function startProxyServer(opts: StartProxyOptions): Promise<RunningProxy> {
  const host = LOOPBACK_HOST;
  const handler = createProxyHandler({
    upstreamBaseUrl: opts.upstreamBaseUrl,
    ...(opts.upstreamFetch ? { upstreamFetch: opts.upstreamFetch } : {}),
    ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
    ...(opts.health ? { health: opts.health } : {}),
    now: opts.now ?? (() => new Date().toISOString()),
    newId: opts.newId ?? (() => randomUUID()),
  });

  const server = createServer((req, res) => {
    void handler(req, res).catch(() => {
      // Last-ditch: a handler throw must never leave a hanging socket.
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    // Surface a pre-listen failure (e.g. EADDRINUSE) as a rejection instead of
    // hanging the promise + emitting an unhandled 'error'.
    server.once("error", reject);
    server.listen(opts.port, host, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : opts.port;
      resolve({
        url: `http://${host}:${port}`,
        port,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
