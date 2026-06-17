import { MEGA_SAVER_CG_BLOCK_END, MEGA_SAVER_CG_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";
import { type ParsedBlock, parseBlock } from "./parse.js";

// Validate the FINAL rendered output is a conformant projection BEFORE it is
// written over a user's agent-config file (fail-closed; spec §11 matrix + §14
// "projection preflight failure aborts the connector write"). Agent-agnostic:
// takes only the rendered string + whether a header/frontmatter is expected, so
// it does not depend on any connector's ConnectorTarget shape.
export function projectionPreflight(
  content: string,
  opts: { expectHeader?: boolean } = {},
): void {
  let managed: ParsedBlock;
  try {
    managed = parseBlock(content);
  } catch (err) {
    throw asProjectionInvalid(err);
  }
  if (managed.block === null) {
    throw new ConnectorError(
      "projection_invalid",
      "rendered output contains no Mega Saver managed block.",
    );
  }

  // The CONTEXT_GATE block is optional (present only when Mega Saver Mode is on);
  // when present it must be exactly one balanced pair.
  try {
    parseBlock(content, { start: MEGA_SAVER_CG_BLOCK_START, end: MEGA_SAVER_CG_BLOCK_END });
  } catch (err) {
    throw asProjectionInvalid(err);
  }

  if (opts.expectHeader === true && managed.before.trim() === "") {
    throw new ConnectorError(
      "projection_invalid",
      "expected connector header/frontmatter before the managed block, but found none.",
    );
  }
}

function asProjectionInvalid(err: unknown): ConnectorError {
  if (err instanceof ConnectorError && err.code === "block_conflict") {
    return new ConnectorError("projection_invalid", err.message, { cause: err });
  }
  if (err instanceof ConnectorError) return err;
  return new ConnectorError("projection_invalid", String(err), { cause: err });
}
