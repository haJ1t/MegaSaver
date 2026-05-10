import { describe, expect, it } from "vitest";
import { projectCreateCommand, projectListCommand } from "../../src/commands/project.js";

describe("projectListCommand — citty wrapper shape", () => {
  it("json arg has type boolean", () => {
    expect(projectListCommand.args?.json?.type).toBe("boolean");
  });

  it("json arg default is false", () => {
    expect(projectListCommand.args?.json?.default).toBe(false);
  });

  it("json arg description matches documented string", () => {
    expect(projectListCommand.args?.json?.description).toBe("Emit JSON output.");
  });
});

describe("projectCreateCommand — citty wrapper shape", () => {
  it("json arg has type boolean", () => {
    expect(projectCreateCommand.args?.json?.type).toBe("boolean");
  });

  it("json arg default is false", () => {
    expect(projectCreateCommand.args?.json?.default).toBe(false);
  });

  it("json arg description matches documented string", () => {
    expect(projectCreateCommand.args?.json?.description).toBe("Emit JSON output.");
  });
});
