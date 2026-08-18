import {
  MEGA_SAVER_FENCE_BLOCK_END,
  MEGA_SAVER_FENCE_BLOCK_START,
} from "./constants.js";
import { ConnectorError } from "./errors.js";
import { containsSentinel } from "./sentinel-guard.js";

export type RenderFenceBlockEntry = {
  path: string;
  class: string;
  mode?: "warn" | "deny" | undefined;
  alternative?: string | undefined;
};

export function renderFenceBlockText(input: {
  entries: ReadonlyArray<RenderFenceBlockEntry>;
}): string {
  if (input.entries.length === 0) return "";

  for (const entry of input.entries) {
    if (
      containsSentinel(entry.path) ||
      (entry.alternative !== undefined && containsSentinel(entry.alternative))
    ) {
      throw new ConnectorError(
        "context_invalid",
        "Fence entries cannot contain Mega Saver sentinels.",
      );
    }
  }

  const lines: string[] = [
    MEGA_SAVER_FENCE_BLOCK_START,
    "# Generated-file fence",
    "",
    "Do not edit generated files directly. Use alternatives where suggested.",
    "",
  ];

  const maxShown = 20;
  const shown = input.entries.slice(0, maxShown);
  for (const entry of shown) {
    const denyTag = entry.mode === "deny" ? ", DENY" : "";
    const altSuffix = entry.alternative ? ` — ${entry.alternative}` : "";
    lines.push(`- \`${entry.path}\` (${entry.class}${denyTag})${altSuffix}`);
  }

  if (input.entries.length > maxShown) {
    const remaining = input.entries.length - maxShown;
    lines.push(`- …and ${remaining} more — see fence.yaml`);
  }

  lines.push("");
  lines.push("To allow editing a fenced path, run: `mega fence allow <path>`");
  lines.push(MEGA_SAVER_FENCE_BLOCK_END);
  lines.push("");

  return lines.join("\n");
}
