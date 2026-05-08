import { CorePersistenceError, CoreRegistryError } from "@megasaver/core";
import { ZodError } from "zod";

export type CliMessage = { message: string; exitCode: 1 };

export type ZodContext =
  | { kind: "name" }
  | { kind: "store" }
  | { kind: "agent" }
  | { kind: "risk" }
  | { kind: "title" }
  | { kind: "sessionId" }
  | { kind: "project"; name: string }
  | { kind: "session"; id: string };

export const NAME_CONTROL_CHARS_MESSAGE = "name must not contain control characters";
export const TITLE_EMPTY_MESSAGE = "title must not be empty";
export const AGENT_INVALID_MESSAGE_PREFIX = "error: invalid agent";
export const RISK_INVALID_MESSAGE_PREFIX = "error: invalid risk";
export const SESSION_ID_INVALID_PREFIX = "error: invalid session id";

const AGENT_VALUES = ["claude-code", "codex", "generic-cli"] as const;
const RISK_VALUES = ["low", "medium", "high", "critical"] as const;

export function duplicateNameMessage(name: string): CliMessage {
  return {
    message: `error: project "${name}" already exists`,
    exitCode: 1,
  };
}

export function projectNotFoundMessage(name: string): CliMessage {
  return {
    message: `error: project "${name}" not found`,
    exitCode: 1,
  };
}

export function sessionNotFoundMessage(id: string): CliMessage {
  return {
    message: `error: session "${id}" not found`,
    exitCode: 1,
  };
}

export function sessionAlreadyEndedMessage(id: string, endedAt: string): CliMessage {
  return {
    message: `error: session "${id}" already ended at ${endedAt}`,
    exitCode: 1,
  };
}

export function invalidAgentMessage(value: string): CliMessage {
  return {
    message: `${AGENT_INVALID_MESSAGE_PREFIX} "${value}", expected: ${AGENT_VALUES.join(" | ")}`,
    exitCode: 1,
  };
}

export function invalidRiskMessage(value: string): CliMessage {
  return {
    message: `${RISK_INVALID_MESSAGE_PREFIX} "${value}", expected: ${RISK_VALUES.join(" | ")}`,
    exitCode: 1,
  };
}

export function invalidSessionIdMessage(value: string): CliMessage {
  return { message: `${SESSION_ID_INVALID_PREFIX} "${value}"`, exitCode: 1 };
}

export function mapErrorToCliMessage(err: unknown, ctx?: ZodContext): CliMessage {
  if (err instanceof ZodError) {
    if (ctx?.kind === "store") {
      return { message: "error: --store path must be non-empty", exitCode: 1 };
    }
    if (ctx?.kind === "title") {
      return { message: `error: ${TITLE_EMPTY_MESSAGE}`, exitCode: 1 };
    }
    if (ctx?.kind === "sessionId") {
      const issue = err.issues[0];
      const value = (issue && "received" in issue ? String(issue.received) : "<unknown>");
      return invalidSessionIdMessage(value);
    }
    const firstIssue = err.issues[0];
    if (firstIssue?.message === NAME_CONTROL_CHARS_MESSAGE) {
      return {
        message: "error: name must not contain control characters",
        exitCode: 1,
      };
    }
    return { message: "error: name must be non-empty", exitCode: 1 };
  }
  if (err instanceof CoreRegistryError) {
    if (err.code === "project_not_found" && ctx?.kind === "project") {
      return projectNotFoundMessage(ctx.name);
    }
    if (err.code === "session_not_found" && ctx?.kind === "session") {
      return sessionNotFoundMessage(ctx.id);
    }
    if (err.code === "session_not_found") {
      // Fallback when no ctx is supplied (rare; surface the raw message).
      return { message: `error: ${err.message}`, exitCode: 1 };
    }
    return { message: `error: ${err.message}`, exitCode: 1 };
  }
  if (err instanceof CorePersistenceError) {
    if (err.code === "store_json_invalid" || err.code === "store_entity_invalid") {
      const path = err.filePath ?? "<unknown>";
      return {
        message: `error: store at ${path} is corrupt: ${err.message}`,
        exitCode: 1,
      };
    }
    return {
      message: `error: store I/O failed: ${err.message}`,
      exitCode: 1,
    };
  }
  if (err instanceof Error) {
    return { message: `error: unexpected failure: ${err.message}`, exitCode: 1 };
  }
  return { message: "error: unexpected failure", exitCode: 1 };
}
