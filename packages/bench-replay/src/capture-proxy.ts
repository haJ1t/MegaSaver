import { mkdirSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { join } from "node:path";

// Records every /v1/messages request body verbatim so a task's conversation can
// later be replayed identically through both arms. Deliberately dumb: it does
// not parse, validate, or rewrite anything on the way through — a recording
// that differs from what the client actually sent would poison every downstream
// measurement.
export type CaptureProxy = { url: string; stop: () => Promise<void>; count: () => number };

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-connection",
]);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

export async function startCaptureProxy(input: {
  port: number;
  upstream: string;
  outDir: string;
}): Promise<CaptureProxy> {
  mkdirSync(input.outDir, { recursive: true });
  let seq = 0;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const url = req.url ?? "/";
      if (url.startsWith("/v1/messages") && body.length > 0) {
        seq += 1;
        writeFileSync(join(input.outDir, `req-${String(seq).padStart(3, "0")}.json`), body);
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || HOP_BY_HOP.has(k.toLowerCase())) continue;
        headers[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      // A recording session strings together a whole conversation; a client that
      // hangs mid-run on a dead upstream is worse than one that fails loudly.
      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(input.upstream + url, {
          method: req.method ?? "GET",
          headers,
          ...(body.length > 0 ? { body } : {}),
          redirect: "manual",
        });
      } catch {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("capture proxy: upstream unreachable");
        return;
      }
      const outHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((v, k) => {
        if (
          !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)
        ) {
          outHeaders[k] = v;
        }
      });
      res.writeHead(upstreamRes.status, outHeaders);
      res.end(Buffer.from(await upstreamRes.arrayBuffer()));
    })();
  });

  await new Promise<void>((resolve) => server.listen(input.port, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : input.port;

  return {
    url: `http://127.0.0.1:${port}`,
    count: () => seq,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
