import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreRegistry } from "@megasaver/core";
import type { BridgeErrorCode } from "../src/bridge-error-code.js";

export type SendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
) => void;

export type SendError = (
  res: ServerResponse,
  status: number,
  code: BridgeErrorCode,
  message: string,
  origin: string | undefined,
  details?: unknown,
) => void;

// Per-request context handed to every route handler. Routes are plain async
// fns so they stay testable in isolation and keep `handler.ts` thin.
export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  registry: CoreRegistry;
  origin: string | undefined;
  query: URLSearchParams;
  newId: () => string;
  now: () => string;
  sendJson: SendJson;
  sendError: SendError;
};
