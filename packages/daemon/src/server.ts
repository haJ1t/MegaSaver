import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { clearDiscovery, writeDiscovery } from "./discovery.js";

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
    if (req.method === "GET" && req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: [], totals: {} }));
      return;
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      res.writeHead(202);
      res.end();
      void close();
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
