import type { AgentId } from "@megasaver/shared";
import { HARNESS_CATALOG, type HarnessDescriptor } from "./catalog.js";

export interface DetectionProbes {
  /** True when `name` resolves to an executable file on PATH. */
  binaryExists(name: string): boolean;
  /** True when the home-relative path (e.g. "~/.cursor") exists. */
  homePathExists(homeRelativePath: string): boolean;
  /** True when a dir entry starting with `prefix` exists under the parent. */
  extensionDirExists(parentHomeRelative: string, prefix: string): boolean;
  /** True when the project-root-relative marker path exists. */
  projectMarkerExists(relativePath: string): boolean;
}

export type MatchedSignalKind = "binary" | "config-dir" | "extension-dir" | "project-marker";

export interface MatchedSignal {
  readonly kind: MatchedSignalKind;
  readonly detail: string;
}

export interface HarnessDetection {
  readonly id: AgentId;
  readonly name: string;
  readonly category: HarnessDescriptor["category"];
  readonly detected: boolean;
  readonly matchedSignals: readonly MatchedSignal[];
  readonly connectorTargetId: string | null;
  readonly coveredByTargetId: string | null;
  /** connectorTargetId ?? coveredByTargetId ?? null — the auto-configure key. */
  readonly effectiveTargetId: string | null;
}

export type DetectHarnessesInput = {
  readonly probes: DetectionProbes;
  /** Restrict detection to these catalog ids. */
  readonly ids?: readonly string[];
};

// Honest detection: a harness is detected iff at least one real signal
// matched; matchedSignals records exactly what matched, nothing inferred.
function detectOne(harness: HarnessDescriptor, probes: DetectionProbes): HarnessDetection {
  const matchedSignals: MatchedSignal[] = [];
  for (const binary of harness.binaries) {
    if (probes.binaryExists(binary)) {
      matchedSignals.push({ kind: "binary", detail: binary });
    }
  }
  for (const dir of harness.configDirs) {
    if (probes.homePathExists(dir)) {
      matchedSignals.push({ kind: "config-dir", detail: dir });
    }
  }
  for (const ext of harness.extensionDirs) {
    if (probes.extensionDirExists(ext.parent, ext.prefix)) {
      matchedSignals.push({ kind: "extension-dir", detail: `${ext.parent}/${ext.prefix}*` });
    }
  }
  for (const marker of harness.projectMarkers) {
    if (probes.projectMarkerExists(marker)) {
      matchedSignals.push({ kind: "project-marker", detail: marker });
    }
  }

  return {
    id: harness.id,
    name: harness.name,
    category: harness.category,
    detected: matchedSignals.length > 0,
    matchedSignals: Object.freeze(matchedSignals),
    connectorTargetId: harness.connectorTargetId,
    coveredByTargetId: harness.coveredByTargetId,
    effectiveTargetId: harness.connectorTargetId ?? harness.coveredByTargetId ?? null,
  };
}

export function detectHarnesses(input: DetectHarnessesInput): HarnessDetection[] {
  let harnesses: readonly HarnessDescriptor[] = HARNESS_CATALOG;
  if (input.ids !== undefined) {
    const byId = new Map(HARNESS_CATALOG.map((h) => [h.id as string, h]));
    const selected: HarnessDescriptor[] = [];
    for (const id of input.ids) {
      const found = byId.get(id);
      if (found === undefined) {
        throw new Error(`unknown harness id: ${id}`);
      }
      selected.push(found);
    }
    harnesses = selected;
  }
  return harnesses.map((harness) => detectOne(harness, input.probes));
}
