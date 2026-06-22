import { describe, expect, it } from "vitest";
import { AgentOfficeError, agentOfficeErrorCodeSchema } from "../src/errors.js";

describe("AgentOfficeError", () => {
  it("carries a typed code and defaults message to the code", () => {
    const err = new AgentOfficeError("not_found");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentOfficeError");
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("not_found");
  });

  it("enumerates all six codes alphabetically", () => {
    expect(agentOfficeErrorCodeSchema.options).toEqual([
      "launcher_not_registered",
      "not_found",
      "permission_denied",
      "schema_invalid",
      "store_corrupt",
      "write_failed",
    ]);
  });

  it("forwards a custom message and cause", () => {
    const root = new Error("disk full");
    const err = new AgentOfficeError("write_failed", "custom", { cause: root });
    expect(err.message).toBe("custom");
    expect(err.cause).toBe(root);
  });
});
