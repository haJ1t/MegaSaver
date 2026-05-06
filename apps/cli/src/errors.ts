import { CorePersistenceError } from "@megasaver/core";
import { ZodError } from "zod";

export type CliMessage = { message: string; exitCode: 1 };

export type ZodContext = { kind: "name" | "store" };

export const NAME_CONTROL_CHARS_MESSAGE = "name must not contain control characters";

export function duplicateNameMessage(name: string): CliMessage {
  return {
    message: `error: project "${name}" already exists`,
    exitCode: 1,
  };
}

export function mapErrorToCliMessage(err: unknown, ctx?: ZodContext): CliMessage {
  if (err instanceof ZodError) {
    if (ctx?.kind === "store") {
      return { message: "error: --store path must be non-empty", exitCode: 1 };
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
