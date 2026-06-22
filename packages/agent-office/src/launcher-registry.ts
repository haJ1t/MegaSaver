import type { AgentLauncher } from "@megasaver/connectors-shared";
import type { AgentId } from "@megasaver/shared";
import { AgentOfficeError } from "./errors.js";

export interface LauncherRegistry {
  get(kind: AgentId): AgentLauncher;
}

export function createLauncherRegistry(launchers: readonly AgentLauncher[]): LauncherRegistry {
  const map = new Map<AgentId, AgentLauncher>();
  for (const l of launchers) {
    if (map.has(l.kind)) {
      throw new AgentOfficeError(
        "launcher_not_registered",
        `Duplicate launcher for kind: ${l.kind}`,
      );
    }
    map.set(l.kind, l);
  }
  return {
    get(kind) {
      const l = map.get(kind);
      if (l === undefined) {
        throw new AgentOfficeError("launcher_not_registered", `No launcher for kind: ${kind}`);
      }
      return l;
    },
  };
}
