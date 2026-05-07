export {
  builtinTargets,
  codexTarget,
  type ConnectorTarget,
  findTarget,
} from "./targets.js";

export {
  GenericCliConnectorError,
  type GenericCliConnectorErrorCode,
  genericCliConnectorErrorCodeSchema,
} from "./errors.js";

export {
  assertGenericCliContext,
  GenericCliContextSchema,
} from "./context.js";

export {
  readGenericCliTarget,
  syncGenericCliTarget,
  writeGenericCliTarget,
} from "./sync.js";
