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

// Stricter than normalizeEol (which keeps lone \r): a field's "\r\r\n" would
// survive it as "\r\n" and re-expand to literal \r\r\n bytes when
// upsertHandoffBlockText converts \n back to \r\n for a CRLF-dominant file.
const toLf = (value: string): string => value.replace(/\r\n?/g, "\n");

// Render-time guard on EVERY interpolated field: open consumes untrusted
// packets, so pack-time sentinel guarding never runs on a hostile path.
export function renderHandoffBlockText(rawFields: HandoffBlockFields): string {
  const fields: HandoffBlockFields = {
    resumeInstructions: toLf(rawFields.resumeInstructions),
    summaryText: toLf(rawFields.summaryText),
    gitLine: rawFields.gitLine === null ? null : toLf(rawFields.gitLine),
    diffText: rawFields.diffText === null ? null : toLf(rawFields.diffText),
    expiresAt: toLf(rawFields.expiresAt),
  };
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
