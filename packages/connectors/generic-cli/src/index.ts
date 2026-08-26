export {
  aiderTarget,
  amazonQTarget,
  antigravityTarget,
  builtinTargets,
  clineTarget,
  codexTarget,
  type ConnectorTarget,
  continueTarget,
  copilotTarget,
  cursorTarget,
  findTarget,
  geminiTarget,
  kiloCodeTarget,
  opencodeTarget,
  qwenTarget,
  rooCodeTarget,
  traeTarget,
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
