import {
  type ConnectorContext,
  ConnectorContextSchema,
} from "@megasaver/connectors-shared";
import { GenericCliConnectorError } from "./errors.js";
import type { ConnectorTarget } from "./targets.js";

export const GenericCliContextSchema = ConnectorContextSchema;

export function assertGenericCliContext(
  input: unknown,
  target: ConnectorTarget,
): ConnectorContext {
  let parsed: ConnectorContext;
  try {
    parsed = GenericCliContextSchema.parse(input);
  } catch (error) {
    throw new GenericCliConnectorError(
      "context_invalid",
      "Generic CLI context is invalid.",
      { cause: error },
    );
  }
  if (parsed.agentId !== target.agentId) {
    throw new GenericCliConnectorError(
      "context_invalid",
      `Context agentId "${parsed.agentId}" does not match target "${target.agentId}".`,
    );
  }
  return parsed;
}
