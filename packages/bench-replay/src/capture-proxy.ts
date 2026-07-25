import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { join } from "node:path";

// Records every /v1/messages request VERBATIM — body in `req-NNN.json`, request
// line and headers in `req-NNN.meta.json` — so a task's conversation can later
// be replayed identically through both arms. Deliberately dumb: it does not
// parse, validate, or rewrite anything on the way through — a recording that
// differs from what the client actually sent would poison every downstream
// measurement.
//
// The headers are not decoration. Claude Code sends a per-request anthropic-beta
// set (prompt-caching-scope, context-1m, context-management, effort) that DIFFERS
// between the main turn and the sidecar turns, the recorded bodies carry
// top-level fields that exist only under those betas, and two of them govern the
// very mechanism this harness measures: prompt-cache scoping and the >200K
// pricing tier. They are also unrecoverable after the fact, which is why they are
// captured rather than reconstructed at replay time.
export type CaptureProxy = { url: string; stop: () => Promise<void>; count: () => number };

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-connection",
]);

// Forwarded upstream, never written to disk: a recording is a file in /tmp that
// gets copied around, and replay authenticates with its own ANTHROPIC_API_KEY.
const CREDENTIAL_HEADERS = new Set(["x-api-key", "authorization", "proxy-authorization"]);

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
  // seq is assigned after `readBody` completes, so file numbering follows
  // body-read-completion order, not arrival order. Fine for Claude Code, which
  // sends /v1/messages requests serially — known ceiling, not enforced.
  let seq = 0;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const url = req.url ?? "/";
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || HOP_BY_HOP.has(k.toLowerCase())) continue;
        headers[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      if (url.startsWith("/v1/messages") && body.length > 0) {
        seq += 1;
        const stem = join(input.outDir, `req-${String(seq).padStart(3, "0")}`);
        writeFileSync(`${stem}.json`, body);
        // The map that is actually forwarded, not an allowlist of the headers we
        // happen to know about today: an allowlist silently drops whatever the
        // next Claude Code release adds, which is the drift this file exists to
        // prevent.
        const recorded = Object.fromEntries(
          Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.has(k.toLowerCase())),
        );
        writeFileSync(`${stem}.meta.json`, JSON.stringify({ url, headers: recorded }));
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
      // Written before any body bytes flow, so headers land ahead of the first
      // chunk on the wire — required for the client to start an SSE parse.
      res.writeHead(upstreamRes.status, outHeaders);
      if (upstreamRes.body) {
        const reader = upstreamRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // Honor backpressure: wait for the client socket to drain rather than
          // queuing unbounded chunks in memory when it can't keep up.
          if (!res.write(Buffer.from(value))) await once(res, "drain");
        }
      }
      res.end();
    })().catch(() => {
      // A client that disconnects mid-body (readBody's `for await` throws) or
      // mid-response must fail only its own request — one broken connection
      // can't be allowed to take down every other in-flight recording.
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end();
    });
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
