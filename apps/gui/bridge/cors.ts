import type { IncomingMessage, ServerResponse } from "node:http";
import type { BridgeErrorCode } from "../src/bridge-error-code.js";

// Vite dev origins — the default when a handler is built without an explicit
// allowlist, preserving `pnpm dev` (frontend on 5173, bridge on 5174).
export const DEFAULT_DEV_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"] as const;

export type SendError = (
  res: ServerResponse,
  status: number,
  code: BridgeErrorCode,
  message: string,
  origin: string | undefined,
  details?: unknown,
) => void;

export type CorsDecision = { allowed: false } | { allowed: true; origin: string | undefined };

// Inspect the Origin header. No header → allow (server-to-server / curl).
// Loopback match → echo the origin back. Anything else → 403 origin_forbidden.
export function applyCorsPolicy(
  req: IncomingMessage,
  res: ServerResponse,
  sendError: SendError,
  allowedOrigins: readonly string[],
): CorsDecision {
  const originHeader = req.headers.origin;
  if (typeof originHeader !== "string" || originHeader.length === 0) {
    return { allowed: true, origin: undefined };
  }
  if (!allowedOrigins.includes(originHeader)) {
    sendError(
      res,
      403,
      "origin_forbidden",
      "Request blocked by the bridge origin policy.",
      undefined,
    );
    return { allowed: false };
  }
  return { allowed: true, origin: originHeader };
}

// OPTIONS preflight — 204 with the requested origin echoed and the methods
// + headers the bridge allows.
export function handleOptionsPreflight(res: ServerResponse, origin: string | undefined): void {
  const headers: { [key: string]: string } = origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "origin",
      }
    : {};
  res.writeHead(204, headers);
  res.end();
}
