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

  it("enumerates the four codes", () => {
    expect(agentOfficeErrorCodeSchema.options).toEqual([
      "not_found",
      "schema_invalid",
      "store_corrupt",
      "write_failed",
    ]);
  });
});
