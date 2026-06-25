import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readJsonBody } from "./body.js";
import { clearDiscovery, writeDiscovery } from "./discovery.js";
import { excerptHandler, expandHandler } from "./handlers.js";

// Hard-coded: the daemon executes shell commands and reads files on behalf of
// the agent, so it must never bind beyond loopback. No host override.
const LOOPBACK = "127.0.0.1";

export type StartDaemonOptions = {
  storeRoot: string;
  /** Default 0 → random free port. */
  port?: number;
  /** Default: a fresh random token. */
  token?: string;
  now?: () => string;
};

export type RunningDaemon = {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
};

export function startDaemonServer(opts: StartDaemonOptions): Promise<RunningDaemon> {
  const token = opts.token ?? randomBytes(24).toString("hex");
  const now = opts.now ?? (() => new Date().toISOString());

  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

    if (req.method === "GET" && path === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: [], totals: {} }));
      return;
    }
    if (req.method === "POST" && path === "/shutdown") {
      res.writeHead(202);
      res.end();
      void close();
      return;
    }
    if (req.method === "POST" && (path === "/excerpt" || path === "/expand")) {
      void (async () => {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "bad body" }));
          return;
        }
        const result =
          path === "/excerpt"
            ? await excerptHandler(opts.storeRoot, body)
            : await expandHandler(opts.storeRoot, body);
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.json));
      })().catch(() => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal" }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      clearDiscovery(opts.storeRoot);
      server.close(() => resolve());
    });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, LOOPBACK, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : (opts.port ?? 0);
      writeDiscovery(opts.storeRoot, { port, token, pid: process.pid, startedAt: now() });
      resolve({ url: `http://${LOOPBACK}:${port}`, port, token, close });
    });
  });
}
