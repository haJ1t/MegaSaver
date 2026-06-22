import type { LauncherPermissionMode } from "@megasaver/connectors-shared";
import { AgentOfficeError } from "./errors.js";
import type { RolePermissionMode } from "./role.js";

export function resolveLauncherPermission(
  roleMode: RolePermissionMode,
  opts: { allowFull: boolean },
): LauncherPermissionMode {
  if (roleMode === "full" && !opts.allowFull) {
    throw new AgentOfficeError(
      "permission_denied",
      "Role requests full permissions but allowFull was not granted.",
    );
  }
  return roleMode;
}
