export {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
} from "./constants.js";
export { renderContextGateBlock } from "./context-gate-block.js";
export {
  type ConnectorContext,
  ConnectorContextSchema,
  assertConnectorContext,
} from "./context.js";
export {
  ConnectorError,
  type ConnectorErrorCode,
  connectorErrorCodeSchema,
} from "./errors.js";
export { renderBlock } from "./render.js";
export { parseBlock, type ParsedBlock } from "./parse.js";
export { removeBlock, upsertBlock } from "./upsert.js";
export {
  assertProjectRoot,
  readTargetFile,
  syncTargetBlock,
  writeTargetFile,
} from "./filesystem.js";
