import { AgentOfficeError } from "@megasaver/agent-office";
import { ConnectorError } from "@megasaver/connectors-shared";
import {
  CorePersistenceError,
  CoreRegistryError,
  memoryConfidenceSchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
} from "@megasaver/core";
import { agentIdSchema, riskLevelSchema, tokenSaverModeSchema } from "@megasaver/shared";
import { ZodError } from "zod";
import { KNOWN_TARGET_IDS } from "./known-targets.js";

export type CliMessage = { message: string; exitCode: 1 };

export type ZodContext =
  | { kind: "name" }
  | { kind: "store" }
  | { kind: "title" }
  | { kind: "sessionId" }
  | { kind: "blockId"; value: string }
  | { kind: "memoryEntryId" }
  | { kind: "memory_create" }
  | { kind: "memory_update" }
  | { kind: "project"; name: string }
  | { kind: "session"; id: string }
  | { kind: "session_update"; id: string }
  | { kind: "connector"; targetId: string; relativePath: string }
  | { kind: "office_role" }
  | { kind: "office_agent" }
  | { kind: "office_task" };

export const NAME_CONTROL_CHARS_MESSAGE = "name must not contain control characters";
export const TITLE_EMPTY_MESSAGE = "title must not be empty";
export const TITLE_CONTROL_CHARS_MESSAGE = "title must not contain control characters";
export const AGENT_INVALID_MESSAGE_PREFIX = "error: invalid agent";
export const RISK_INVALID_MESSAGE_PREFIX = "error: invalid risk";
export const SESSION_ID_INVALID_PREFIX = "error: invalid session id";
export const BLOCK_ID_INVALID_PREFIX = "error: invalid block id";
export const MODE_INVALID_MESSAGE_PREFIX = "error: invalid mode";

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
    message: `${AGENT_INVALID_MESSAGE_PREFIX} "${value}", expected: ${agentIdSchema.options.join(" | ")}`,
    exitCode: 1,
  };
}

export function invalidRiskMessage(value: string): CliMessage {
  return {
    message: `${RISK_INVALID_MESSAGE_PREFIX} "${value}", expected: ${riskLevelSchema.options.join(" | ")}`,
    exitCode: 1,
  };
}

export function invalidModeMessage(value: string): CliMessage {
  return {
    message: `${MODE_INVALID_MESSAGE_PREFIX} "${value}", expected: ${tokenSaverModeSchema.options.join(" | ")}`,
    exitCode: 1,
  };
}

export function missingModeMessage(): CliMessage {
  return { message: "error: --mode is required for enable", exitCode: 1 };
}

export function unexpectedModeMessage(): CliMessage {
  return { message: "error: --mode is only valid for enable", exitCode: 1 };
}

export function invalidSessionIdMessage(value: string): CliMessage {
  return { message: `${SESSION_ID_INVALID_PREFIX} "${value}"`, exitCode: 1 };
}

export function invalidBlockIdMessage(value: string): CliMessage {
  return { message: `${BLOCK_ID_INVALID_PREFIX} "${value}"`, exitCode: 1 };
}

export function nothingToUpdateMessage(): CliMessage {
  return { message: "error: nothing to update", exitCode: 1 };
}

export function invalidTargetMessage(value: string): CliMessage {
  return {
    message: `error: invalid target "${value}", expected: ${KNOWN_TARGET_IDS.join(" | ")}`,
    exitCode: 1,
  };
}

export function unknownTargetMessage(value: string): CliMessage {
  return {
    message: `error: unknown_target "${value}", expected: ${KNOWN_TARGET_IDS.join(" | ")}`,
    exitCode: 1,
  };
}

export function mapErrorToCliMessage(err: unknown, ctx?: ZodContext): CliMessage {
  if (err instanceof ZodError) {
    if (ctx?.kind === "store") {
      return { message: "error: --store path must be non-empty", exitCode: 1 };
    }
    if (ctx?.kind === "title") {
      const firstIssue = err.issues[0];
      if (firstIssue?.message === NAME_CONTROL_CHARS_MESSAGE) {
        return { message: `error: ${TITLE_CONTROL_CHARS_MESSAGE}`, exitCode: 1 };
      }
      return { message: `error: ${TITLE_EMPTY_MESSAGE}`, exitCode: 1 };
    }
    if (ctx?.kind === "sessionId") {
      // Zod's `invalid_type` issue carries a `received` field with the offending value;
      // other issue codes don't, so fall back to "<unknown>".
      const issue = err.issues[0];
      const value = issue && "received" in issue ? String(issue.received) : "<unknown>";
      return invalidSessionIdMessage(value);
    }
    if (ctx?.kind === "blockId") {
      return invalidBlockIdMessage(ctx.value);
    }
    if (ctx?.kind === "session_update") {
      const issue = err.issues[0];
      const path = issue && issue.path.length > 0 ? issue.path.join(".") : "<unknown>";
      const msg = issue?.message ?? "invalid";
      return { message: `error: invalid session update: ${path}: ${msg}`, exitCode: 1 };
    }
    if (
      ctx?.kind === "office_role" ||
      ctx?.kind === "office_agent" ||
      ctx?.kind === "office_task"
    ) {
      const entity =
        ctx.kind === "office_role" ? "role" : ctx.kind === "office_agent" ? "agent" : "task";
      const issue = err.issues[0];
      const path = issue && issue.path.length > 0 ? issue.path.join(".") : "<unknown>";
      // A failing `id` field means a malformed id was passed (e.g. `mega office
      // assign not-a-uuid ...`); surface an id-oriented message rather than the
      // generic "name must be non-empty" fall-through.
      if (path === "id") {
        return { message: `error: invalid ${entity} id`, exitCode: 1 };
      }
      const msg = issue?.message ?? "invalid";
      return { message: `error: invalid ${entity} field: ${path} (${msg})`, exitCode: 1 };
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
    if (
      err.code === "session_not_found" &&
      (ctx?.kind === "session" || ctx?.kind === "session_update")
    ) {
      return sessionNotFoundMessage(ctx.id);
    }
    // Outer-catch fall-through from runSessionEnd's three-way race (session
    // vanished after the pre-check AND after the inner catch's getSession
    // refresh). We have no endedAt in scope here, so produce the id-only
    // shape rather than the rich "already ended at <ts>" shape.
    if (
      err.code === "session_already_ended" &&
      (ctx?.kind === "session" || ctx?.kind === "session_update")
    ) {
      return {
        message: `error: session "${ctx.id}" already ended`,
        exitCode: 1,
      };
    }
    if (err.code === "memory_entry_not_found") {
      return { message: "error: memory entry not found", exitCode: 1 };
    }
    if (err.code === "memory_entry_already_exists") {
      return { message: "error: memory entry already exists", exitCode: 1 };
    }
    if (err.code === "session_project_mismatch") {
      return {
        message: "error: --session does not belong to the specified project",
        exitCode: 1,
      };
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
  if (err instanceof AgentOfficeError) {
    if (err.code === "not_found") {
      const entity =
        ctx?.kind === "office_role"
          ? "role"
          : ctx?.kind === "office_agent"
            ? "agent"
            : ctx?.kind === "office_task"
              ? "task"
              : "entity";
      return { message: `error: ${entity} not found`, exitCode: 1 };
    }
    if (err.code === "permission_denied") {
      return officePermissionDeniedMessage(err.message);
    }
    if (err.code === "schema_invalid") {
      return officeSchemaInvalidMessage(err.message);
    }
    return { message: `error: ${err.code}: ${err.message}`, exitCode: 1 };
  }
  if (err instanceof ConnectorError) {
    if (ctx?.kind === "connector") {
      switch (err.code) {
        case "context_invalid":
          return {
            message: `error: connector context invalid for target "${ctx.targetId}": ${err.message}`,
            exitCode: 1,
          };
        case "block_conflict":
          return {
            message: `error: connector block conflict in ${ctx.relativePath}: ${err.message}`,
            exitCode: 1,
          };
        case "file_read_failed":
          return {
            message: `error: connector failed to read ${ctx.relativePath}: ${err.message}`,
            exitCode: 1,
          };
        case "file_write_failed":
          return {
            message: `error: connector failed to write ${ctx.relativePath}: ${err.message}`,
            exitCode: 1,
          };
        case "target_path_invalid":
          return {
            message: `error: project root invalid: ${err.message}`,
            exitCode: 1,
          };
        case "projection_invalid":
          return {
            message: `error: connector projection invalid for ${ctx.relativePath}: ${err.message}`,
            exitCode: 1,
          };
      }
    }
    if (err.code === "target_path_invalid") {
      return {
        message: `error: project root invalid: ${err.message}`,
        exitCode: 1,
      };
    }
    return { message: `error: ${err.code}: ${err.message}`, exitCode: 1 };
  }
  if (err instanceof Error) {
    return { message: `error: unexpected failure: ${err.message}`, exitCode: 1 };
  }
  return { message: "error: unexpected failure", exitCode: 1 };
}

export function intentRequiredMessage(): CliMessage {
  return { message: "error: intent_required: --intent is required", exitCode: 1 };
}

export function fileRequiredMessage(): CliMessage {
  return { message: "error: file_required: --file is required", exitCode: 1 };
}

export function pathDeniedMessage(reason: string): CliMessage {
  return { message: `error: path_denied: ${reason}`, exitCode: 1 };
}

export function pathUnsafeMessage(detail: string): CliMessage {
  return { message: `error: path_unsafe: ${detail}`, exitCode: 1 };
}

export function fileReadFailedMessage(detail: string): CliMessage {
  return { message: `error: file_read_failed: ${detail}`, exitCode: 1 };
}

// A present-but-malformed .megasaver/permissions.yaml denies the operation
// fail-closed (permissions-yaml §5.3); the command/file is NEVER run/read.
export function policyLoadFailedMessage(detail: string): CliMessage {
  return { message: `error: policy_load_failed: ${detail}`, exitCode: 1 };
}

// BB7b `mega output exec` boundary builders. `<reason>` is a PolicyDenyCode
// string so the same value is observable from the CLI and (post-BB8) the MCP
// envelope. No redactionFailedMessage: redaction is internal to filterOutput,
// not a separate orchestrator step (spec §3.6).
export function commandDeniedMessage(reason: string): CliMessage {
  return { message: `error: command_denied: ${reason}`, exitCode: 1 };
}

export function commandFailedMessage(detail: string): CliMessage {
  return { message: `error: command_failed: ${detail}`, exitCode: 1 };
}

export function storeWriteFailedMessage(detail: string): CliMessage {
  return { message: `error: store_write_failed: ${detail}`, exitCode: 1 };
}

export function invalidChunkSetIdMessage(): CliMessage {
  return { message: "error: invalid_chunk_set_id", exitCode: 1 };
}

export function invalidChunkIdMessage(): CliMessage {
  return { message: "error: invalid_chunk_id", exitCode: 1 };
}

export function chunkSetNotFoundMessage(): CliMessage {
  return { message: "error: chunk_set_not_found", exitCode: 1 };
}

// `mega pack` boundary: SkillPackError codes surface verbatim so the
// CLI and library observe the same closed enum.
export function skillPackErrorMessage(code: string, detail: string): CliMessage {
  return { message: `error: ${code}: ${detail}`, exitCode: 1 };
}

export function chunkNotFoundMessage(): CliMessage {
  return { message: "error: chunk_not_found", exitCode: 1 };
}

export function storeCorruptMessage(detail: string): CliMessage {
  return { message: `error: store_corrupt: ${detail}`, exitCode: 1 };
}

export function memoryEntryNotFoundMessage(id: string): CliMessage {
  return { message: `error: memory entry "${id}" not found`, exitCode: 1 };
}

export function invalidScopeMessage(value: string): CliMessage {
  return {
    message: `error: invalid scope "${value}", expected: ${memoryScopeSchema.options.join(" | ")}`,
    exitCode: 1,
  };
}

export function scopeProjectWithSessionMessage(): CliMessage {
  return {
    message: "error: --session is not allowed when --scope is project",
    exitCode: 1,
  };
}

export function scopeSessionWithoutSessionMessage(): CliMessage {
  return {
    message: "error: --session is required when --scope is session",
    exitCode: 1,
  };
}

export function invalidTypeMessage(value: string): CliMessage {
  return {
    message: `error: invalid type "${value}", expected: ${memoryTypeSchema.options.join(" | ")}`,
    exitCode: 1,
  };
}

export function invalidConfidenceMessage(value: string): CliMessage {
  return {
    message: `error: invalid confidence "${value}", expected: ${memoryConfidenceSchema.options.join(" | ")}`,
    exitCode: 1,
  };
}

export function invalidSourceMessage(value: string): CliMessage {
  return {
    message: `error: invalid source "${value}", expected: ${memorySourceSchema.options.join(" | ")}`,
    exitCode: 1,
  };
}

export function deleteRequiresConfirmMessage(): CliMessage {
  return { message: "error: refusing to delete without --yes", exitCode: 1 };
}

export function emptyFieldMessage(field: string): CliMessage {
  return { message: `error: ${field} must not be empty`, exitCode: 1 };
}

export function invalidExpiresMessage(value: string): CliMessage {
  return {
    message: `error: invalid expires "${value}", expected ISO-8601 datetime`,
    exitCode: 1,
  };
}

export function invalidAsOfMessage(value: string): CliMessage {
  return {
    message: `error: invalid as-of "${value}", expected ISO-8601 datetime`,
    exitCode: 1,
  };
}

export function officePermissionDeniedMessage(detail: string): CliMessage {
  return { message: `error: permission_denied: ${detail}`, exitCode: 1 };
}

export function officeSchemaInvalidMessage(detail: string): CliMessage {
  return { message: `error: schema_invalid: ${detail}`, exitCode: 1 };
}

export function invalidPermissionModeMessage(value: string): CliMessage {
  return {
    message: `error: invalid permission-mode "${value}", expected: plan | acceptEdits | full`,
    exitCode: 1,
  };
}

export function invalidRoleModelMessage(value: string): CliMessage {
  return {
    message: `error: invalid model "${value}", expected: opus | sonnet | haiku`,
    exitCode: 1,
  };
}

export function invalidToolMessage(value: string): CliMessage {
  return {
    message: `error: invalid tool "${value}": tool must not start with '-'`,
    exitCode: 1,
  };
}
