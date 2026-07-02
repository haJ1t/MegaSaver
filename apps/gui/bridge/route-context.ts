import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreRegistry } from "@megasaver/core";
import type { McpSetupOps } from "@megasaver/mcp-bridge";
import type { BridgeErrorCode } from "../src/bridge-error-code.js";
import type { resolveWorkspace } from "./workspace-resolver.js";

// Injected office deps. Optional so existing handlers and tests are unaffected
// when office routes are not exercised. Production server.ts always populates it.
export type OfficeContext = {
  coreRegistry: CoreRegistry;
  registry: import("@megasaver/agent-office").LauncherRegistry;
  allowFull: boolean;
};

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
export type SendText = (res: ServerResponse, status: number, body: string, origin?: string) => void;

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  // F3: BB8-built production facade; BB11's mcp-setup routes read it. Always
  // resolved by createBridgeHandler (production = buildMcpSetupOps; tests may
  // inject a fake or fall back to an empty-status ops object).
  mcpOps: McpSetupOps;
  // Optional registry for routes that need persisted project metadata. Omitted
  // in tests that exercise routes without a registry (handler-no-registry).
  registry?: CoreRegistry | undefined;
  origin: string | undefined;
  query: URLSearchParams;
  storeRoot: string;
  // Absolute path to ~/.claude/projects (overridable in tests). Read-only source
  // for the Claude Code live-sessions routes.
  claudeProjectsDir: string;
  // Absolute path to the desktop app's session-metadata dir (claude-code-sessions),
  // source of the AI-generated session titles. Overridable in tests.
  claudeSessionsMetaDir: string;
  // Absolute path to ~/.claude/settings.json (overridable in tests). Target of
  // the global Claude Code hook connect/disconnect route.
  claudeSettingsPath: string;
  // Pure cwd → { workspaceKey, label, cwd } resolver, injected once so tests can
  // override it. Used by the workspace-scoped routes.
  resolveWorkspace: typeof resolveWorkspace;
  newId: () => string;
  now: () => string;
  sendJson: SendJson;
  sendError: SendError;
  sendText: SendText;
  /** Office supervisor deps — populated by createBridgeHandler in production; injected in tests. */
  office?: OfficeContext;
};
