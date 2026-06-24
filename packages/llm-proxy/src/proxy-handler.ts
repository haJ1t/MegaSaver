import type { IncomingMessage, ServerResponse } from "node:http";
import { countRequestMessages, parseUsageFromJson, parseUsageFromSse } from "./parse-usage.js";
import type { ProxyUsageEvent } from "./usage-event.js";

export type ProxyHandlerDeps = {
  upstreamBaseUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  upstreamFetch?: typeof fetch;
  onUsage?: (event: ProxyUsageEvent) => void;
  now: () => string;
  newId: () => string;
};

// Request hop-by-hop headers the proxy must not forward (the fetch layer sets
// its own). Auth headers (x-api-key / authorization) are deliberately NOT here —
// they pass through verbatim.
const STRIP_REQUEST = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-connection",
]);

// fetch() transparently decompresses the body, so a forwarded content-encoding /
// length would describe bytes the client never receives. Drop them; let Node
// frame the re-streamed (already-decoded) bytes.
const STRIP_RESPONSE = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

const MAX_CAPTURE_BYTES = 2_000_000;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function filterRequestHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || STRIP_REQUEST.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!STRIP_RESPONSE.has(key.toLowerCase())) out[key] = value;
  });
  return out;
}

// Transparent local proxy: forwards the request to the upstream Anthropic API
// unchanged and streams the response straight back. For POST /v1/messages it
// additionally records the round-trip's token usage (counts + model only — never
// the request/response bodies or auth headers). Measurement is wrapped so it can
// never alter or break what the client receives.
export function createProxyHandler(
  deps: ProxyHandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { upstreamBaseUrl, onUsage, now, newId } = deps;
  const doFetch = deps.upstreamFetch ?? fetch;

  return async (req, res) => {
    const path = req.url ?? "/";
    const method = req.method ?? "GET";
    const bodyBuf = await readBody(req);
    const headers = filterRequestHeaders(req.headers);
    const init: RequestInit =
      bodyBuf.length > 0 ? { method, headers, body: bodyBuf } : { method, headers };

    let upstream: Response;
    try {
      upstream = await doFetch(`${upstreamBaseUrl}${path}`, init);
    } catch {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("mega proxy: upstream request failed");
      return;
    }

    const respHeaders = responseHeaders(upstream.headers);
    res.writeHead(upstream.status, respHeaders);

    const captured: Buffer[] = [];
    let capturedLen = 0;
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        res.write(buf);
        if (capturedLen < MAX_CAPTURE_BYTES) {
          captured.push(buf);
          capturedLen += buf.length;
        }
      }
    }
    res.end();

    try {
      if (method === "POST" && path.startsWith("/v1/messages") && onUsage) {
        const { model, messageCount } = countRequestMessages(bodyBuf.toString("utf8"));
        const contentType = String(respHeaders["content-type"] ?? "");
        const stream = contentType.includes("event-stream");
        const text = Buffer.concat(captured).toString("utf8");
        const usage = stream ? parseUsageFromSse(text) : parseUsageFromJson(text);
        if (usage) {
          onUsage({
            id: newId(),
            ts: now(),
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            messageCount,
            stream,
          });
        }
      }
    } catch {
      // Measurement is best-effort; never affect the proxied response.
    }
  };
}
