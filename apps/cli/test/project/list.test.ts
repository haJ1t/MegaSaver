import { describe, expect, it } from "vitest";
import {
  connectorStatusCommand,
  connectorSyncCommand,
} from "../../src/commands/connector/index.js";
import {
  memoryCreateCommand,
  memoryListCommand,
  memoryShowCommand,
} from "../../src/commands/memory/index.js";
import { projectCreateCommand, projectListCommand } from "../../src/commands/project.js";
import {
  sessionCreateCommand,
  sessionEndCommand,
  sessionUpdateCommand,
} from "../../src/commands/session/index.js";

const JSON_DESCRIPTION = "Emit JSON output.";

describe.each([
  ["projectListCommand", projectListCommand],
  ["projectCreateCommand", projectCreateCommand],
  ["sessionCreateCommand", sessionCreateCommand],
  ["sessionEndCommand", sessionEndCommand],
  ["sessionUpdateCommand", sessionUpdateCommand],
  ["memoryCreateCommand", memoryCreateCommand],
  ["memoryListCommand", memoryListCommand],
  ["memoryShowCommand", memoryShowCommand],
  ["connectorStatusCommand", connectorStatusCommand],
  ["connectorSyncCommand", connectorSyncCommand],
] as const)("%s — citty wrapper drift guard for --json", (_name, command) => {
  it("json arg has type boolean", () => {
    expect(command.args?.json?.type).toBe("boolean");
  });

  it("json arg default is false", () => {
    expect(command.args?.json?.default).toBe(false);
  });

  it("json arg description matches canonical string", () => {
    expect(command.args?.json?.description).toBe(JSON_DESCRIPTION);
  });
});
