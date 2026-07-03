import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HEALTH_PATH, buildHealthResponse } from "./health.js";
import { countRequestMessages, createSseUsageScanner, parseUsageFromJson } from "./parse-usage.js";
import type { ProxyUsageEvent } from "./usage-event.js";

export type ProxyHandlerDeps = {
  upstreamBaseUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  upstreamFetch?: typeof fetch;
  onUsage?: (event: ProxyUsageEvent) => void;
  // Ownership health: when set, the reserved health path answers locally with a
  // nonce-bound proof and is never forwarded upstream.
  health?: { capability: string; instanceId: string };
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

// Non-stream JSON message responses are small; cap the capture so a pathological
// body can't balloon memory. Streaming responses are NOT captured — they are
// scanned incrementally (see below), so their size is irrelevant to memory.
const MAX_JSON_CAPTURE_BYTES = 5_000_000;
// Whole request body is buffered before forwarding (no upstream request
// streaming), so bound it. Generous headroom for image/large-context requests.
const MAX_REQUEST_BYTES = 50_000_000;

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_REQUEST_BYTES) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function pathnameOf(target: string): string {
  const q = target.indexOf("?");
  return q === -1 ? target : target.slice(0, q);
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
  const { upstreamBaseUrl, onUsage, health, now, newId } = deps;
  const doFetch = deps.upstreamFetch ?? fetch;

  return async (req, res) => {
    const path = req.url ?? "/";
    const method = req.method ?? "GET";

    // Ownership health-check: the reserved path is answered locally and is NEVER
    // forwarded upstream — even when this instance has no ownership capability
    // configured (then it 404s). Intercepting unconditionally guarantees a probe
    // of the reserved path can never leak to the upstream as a normal request.
    // The pathname is matched exactly (ignoring the query) so a hostile
    // request-target cannot reach it and it never becomes an upstream path.
    if (pathnameOf(path) === HEALTH_PATH) {
      if (!health) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("mega proxy: not found");
        return;
      }
      const challenge = new URLSearchParams(path.split("?")[1] ?? "").get("challenge") ?? "";
      const payload = JSON.stringify(
        buildHealthResponse(health.capability, health.instanceId, challenge),
      );
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(payload);
      return;
    }

    const bodyBuf = await readBody(req);
    if (bodyBuf === null) {
      res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
      res.end("mega proxy: request body too large");
      return;
    }
    const headers = filterRequestHeaders(req.headers);
    // redirect:"manual" is a security invariant, not a preference: the default
    // (follow) would re-send the client's auth headers (x-api-key /
    // authorization) to whatever origin a 3xx Location points at — a hostile or
    // misconfigured upstream could exfiltrate the operator's key by redirecting
    // to an attacker host. Instead we hand the raw 3xx back to the client and
    // never auto-follow across origins.
    const base: RequestInit = { method, headers, redirect: "manual" };
    const init: RequestInit = bodyBuf.length > 0 ? { ...base, body: bodyBuf } : base;

    let upstream: Response;
    try {
      // String concat (NOT new URL(path, base)) is deliberate: it keeps the
      // upstream host a literal prefix so a hostile request-target (`//evil`,
      // absolute-form) becomes a path under api.anthropic.com, never a new
      // origin. Do not "fix" this to new URL() — that reintroduces SSRF.
      upstream = await doFetch(`${upstreamBaseUrl}${path}`, init);
    } catch {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("mega proxy: upstream request failed");
      return;
    }

    const respHeaders = responseHeaders(upstream.headers);
    res.writeHead(upstream.status, respHeaders);

    const contentType = String(respHeaders["content-type"] ?? "");
    const stream = contentType.includes("event-stream");
    // SSE → scan incrementally (no body retained); JSON → capture (bounded).
    const scanner = stream ? createSseUsageScanner() : null;
    const decoder = new TextDecoder();
    const jsonCaptured: Buffer[] = [];
    let jsonLen = 0;

    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        // Honor backpressure: if the client socket is full, wait for it to drain
        // before pulling more from upstream, so a slow client can't balloon the
        // proxy's heap.
        if (!res.write(buf)) await once(res, "drain");
        if (scanner) {
          scanner.push(decoder.decode(value, { stream: true }));
        } else if (jsonLen < MAX_JSON_CAPTURE_BYTES) {
          jsonCaptured.push(buf);
          jsonLen += buf.length;
        }
      }
    }
    res.end();

    try {
      if (method === "POST" && path.startsWith("/v1/messages") && onUsage) {
        const { model, messageCount } = countRequestMessages(bodyBuf.toString("utf8"));
        const usage = scanner
          ? scanner.result()
          : parseUsageFromJson(Buffer.concat(jsonCaptured).toString("utf8"));
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
