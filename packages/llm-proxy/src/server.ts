import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createProxyHandler } from "./proxy-handler.js";
import type { ProxyUsageEvent } from "./usage-event.js";

export type StartProxyOptions = {
  /** Defaults to 127.0.0.1 — the proxy is local-only and never binds publicly. */
  host?: string;
  port: number;
  upstreamBaseUrl: string;
  upstreamFetch?: typeof fetch;
  onUsage?: (event: ProxyUsageEvent) => void;
  now?: () => string;
  newId?: () => string;
};

export type RunningProxy = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export function startProxyServer(opts: StartProxyOptions): Promise<RunningProxy> {
  const host = opts.host ?? "127.0.0.1";
  const handler = createProxyHandler({
    upstreamBaseUrl: opts.upstreamBaseUrl,
    ...(opts.upstreamFetch ? { upstreamFetch: opts.upstreamFetch } : {}),
    ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
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

  return new Promise((resolve) => {
    server.listen(opts.port, host, () => {
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
