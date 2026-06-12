export {
  aiderTarget,
  builtinTargets,
  codexTarget,
  type ConnectorTarget,
  continueTarget,
  cursorTarget,
  findTarget,
  geminiTarget,
  validateConnectorTarget,
  windsurfTarget,
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
