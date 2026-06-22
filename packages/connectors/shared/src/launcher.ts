import type { AgentId } from "@megasaver/shared";
import { z } from "zod";

export const launcherPermissionModeSchema = z.enum(["plan", "acceptEdits", "full"]);
export type LauncherPermissionMode = z.infer<typeof launcherPermissionModeSchema>;
export const launcherModelSchema = z.enum(["opus", "sonnet", "haiku"]);
export type LauncherModel = z.infer<typeof launcherModelSchema>;

export interface LaunchInput {
  workdir: string;
  instruction: string;
  model: LauncherModel;
  permissionMode: LauncherPermissionMode;
  allowedTools: readonly string[];
  persona?: string;
  sessionId?: string;
  resumeSessionId?: string;
}

export type LauncherEvent = { kind: "stream"; payload: unknown } | { kind: "stderr"; text: string };

export interface LaunchHandle {
  readonly sessionId: string;
  onEvent(cb: (event: LauncherEvent) => void): void;
  onExit(cb: (result: { code: number | null }) => void): void;
  cancel(signal?: NodeJS.Signals): void;
}

export interface AgentLauncher {
  readonly kind: AgentId;
  launch(input: LaunchInput): LaunchHandle;
}

export const launcherErrorCodeSchema = z.enum(["invalid_session_config"]);
export type LauncherErrorCode = z.infer<typeof launcherErrorCodeSchema>;

export class LauncherError extends Error {
  readonly code: LauncherErrorCode;

  constructor(code: LauncherErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LauncherError";
    this.code = code;
  }
}
