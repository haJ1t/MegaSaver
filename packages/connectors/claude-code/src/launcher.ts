import {
  type LaunchInput,
  LauncherError,
  type LauncherPermissionMode,
} from "@megasaver/connectors-shared";

const PERMISSION_MODE_FLAG: Record<LauncherPermissionMode, string> = {
  plan: "plan",
  acceptEdits: "acceptEdits",
  full: "bypassPermissions",
};

export function buildClaudeArgs(input: LaunchInput): string[] {
  const hasNew = input.sessionId !== undefined;
  const hasResume = input.resumeSessionId !== undefined;
  if (hasNew === hasResume) {
    throw new LauncherError(
      "invalid_session_config",
      "Provide exactly one of sessionId or resumeSessionId.",
    );
  }

  const args = [
    "-p",
    input.instruction,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--permission-mode",
    PERMISSION_MODE_FLAG[input.permissionMode],
  ];

  if (input.allowedTools.length > 0) {
    args.push("--allowedTools", ...input.allowedTools);
  }
  if (input.persona !== undefined) {
    args.push("--append-system-prompt", input.persona);
  }
  if (input.resumeSessionId !== undefined) {
    args.push("--resume", input.resumeSessionId);
  } else if (input.sessionId !== undefined) {
    args.push("--session-id", input.sessionId);
  }

  return args;
}
