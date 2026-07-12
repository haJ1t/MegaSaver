import { MEGA_SAVER_WS_BLOCK_END, MEGA_SAVER_WS_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";
import { containsSentinel } from "./sentinel-guard.js";

export type WarmStartBlockFields = { briefText: string; asOf: string };

export function renderWarmStartBlockText(fields: WarmStartBlockFields): string {
  if (containsSentinel(fields.briefText)) {
    throw new ConnectorError(
      "context_invalid",
      "Warm-start brief cannot contain Mega Saver sentinels.",
    );
  }
  return [
    MEGA_SAVER_WS_BLOCK_START,
    fields.briefText.trimEnd(),
    "",
    `As of: ${fields.asOf} — run "mega warmup --write" to refresh`,
    MEGA_SAVER_WS_BLOCK_END,
    "",
  ].join("\n");
}
