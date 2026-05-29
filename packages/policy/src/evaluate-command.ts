import type { ProjectId } from "@megasaver/shared";
import { ALLOWED_COMMANDS } from "./allowed-commands.js";
import { DANGEROUS_PATTERNS } from "./dangerous-patterns.js";
import type { PolicyDenyCode } from "./deny-code.js";

export type EvaluateCommandInput = {
  command: string;
  args: readonly string[];
  project: ProjectId;
  env?: {
    readonly MEGASAVER_ORIGIN_PID?: string;
  };
};

export type EvaluateCommandResult = { allowed: true } | { allowed: false; reason: PolicyDenyCode };

export function evaluateCommand(input: EvaluateCommandInput): EvaluateCommandResult {
  const originPid = input.env?.MEGASAVER_ORIGIN_PID;
  if (originPid && originPid !== String(process.pid)) {
    return { allowed: false, reason: "recursive_megasaver" };
  }

  const line = [input.command, ...input.args].join(" ");
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(line)) {
      return { allowed: false, reason: "dangerous_pattern" };
    }
  }

  if (!ALLOWED_COMMANDS.includes(input.command)) {
    return { allowed: false, reason: "command_not_allowed" };
  }

  return { allowed: true };
}
