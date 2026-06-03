import type { ProjectId } from "@megasaver/shared";
import { ALLOWED_COMMANDS } from "./allowed-commands.js";
import { DANGEROUS_PATTERNS } from "./dangerous-patterns.js";
import type { PolicyDenyCode } from "./deny-code.js";
import type { ProjectPermissions } from "./parse-project-permissions.js";

export type EvaluateCommandInput = {
  command: string;
  args: readonly string[];
  project: ProjectId;
  env?: {
    readonly MEGASAVER_ORIGIN_PID?: string;
  };
  // Additional, tighten-only project denials (permissions-yaml §4.2). Optional;
  // absent ⇒ baseline only. It can ONLY add denials — there is no field to
  // re-allow a baseline-denied command (I1).
  permissions?: ProjectPermissions;
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

  // Project deny.commands is the LAST AND-gate (I2): it runs only after every
  // baseline denial has short-circuited, so it can tighten an allow into a deny
  // but never loosen a baseline deny. Exact-string match like ALLOWED_COMMANDS.
  if (input.permissions?.denyCommands.includes(input.command)) {
    return { allowed: false, reason: "command_not_allowed" };
  }

  return { allowed: true };
}
