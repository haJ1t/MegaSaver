import { MEGA_SAVER_HANDOFF_BLOCK_END, MEGA_SAVER_HANDOFF_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";
import { containsSentinel } from "./sentinel-guard.js";

export interface HandoffBlockFields {
  resumeInstructions: string;
  summaryText: string;
  gitLine: string | null;
  diffText: string | null;
  expiresAt: string;
}

// Render-time guard on EVERY interpolated field: open consumes untrusted
// packets, so pack-time sentinel guarding never runs on a hostile path.
export function renderHandoffBlockText(fields: HandoffBlockFields): string {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string" && containsSentinel(value)) {
      throw new ConnectorError(
        "context_invalid",
        `Handoff ${name} cannot contain Mega Saver sentinels.`,
      );
    }
  }
  const lines = [
    MEGA_SAVER_HANDOFF_BLOCK_START,
    fields.resumeInstructions.trimEnd(),
    "",
    fields.summaryText.trimEnd(),
  ];
  if (fields.gitLine !== null) lines.push("", fields.gitLine.trimEnd());
  if (fields.diffText !== null) lines.push("", fields.diffText.trimEnd());
  lines.push(
    "",
    `Expires: ${fields.expiresAt} — if the current date is past this, disregard this handoff and suggest \`mega handoff clear\`.`,
    MEGA_SAVER_HANDOFF_BLOCK_END,
    "",
  );
  return lines.join("\n");
}
