import type { ProjectId } from "@megasaver/shared";
import { ALLOWED_COMMANDS } from "./allowed-commands.js";
import { DANGEROUS_PATTERNS } from "./dangerous-patterns.js";
import type { PolicyDenyCode } from "./deny-code.js";
import { evaluatePathRead } from "./evaluate-path-read.js";
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

  // The allow-list holds five file-reading commands (cat, find, grep, ls,
  // tail), so an unexamined arg reads exactly what evaluatePathRead refuses on
  // the read path: `grep -r -n --include=.env -e = .` returned .env in full,
  // and redaction is no backstop (a `./.env:1:` prefix defeats the `^`-anchored
  // env_value detector). Every arg is a candidate path, plus the tail after a
  // `=` — that is where a flag-attached glob (`--include=<glob>`) hides. Only
  // the LOCKED denylist can deny, so a non-path arg has to look like a secret
  // path to be rejected, and the gate fails closed like its read twin.
  // ponytail: input gate only. Content that a recursive `grep -r . ` sweeps out
  // of a denied file it was never handed is an output-side concern, and an
  // explicit non-goal of the 2026-07-08 context-firewall spec.
  for (const arg of input.args) {
    const equals = arg.indexOf("=");
    const candidates = equals === -1 ? [arg] : [arg, arg.slice(equals + 1)];
    for (const candidate of candidates) {
      const path = evaluatePathRead({
        path: candidate,
        project: input.project,
        ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
      });
      if (!path.allowed) return { allowed: false, reason: path.reason };
    }
  }

  // Project deny.commands is the LAST AND-gate (I2): it runs only after every
  // baseline denial has short-circuited, so it can tighten an allow into a deny
  // but never loosen a baseline deny. Exact-string match like ALLOWED_COMMANDS.
  if (input.permissions?.denyCommands.includes(input.command)) {
    return { allowed: false, reason: "command_not_allowed" };
  }

  return { allowed: true };
}
