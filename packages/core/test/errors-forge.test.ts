import { describe, expect, it } from "vitest";
import { coreRegistryErrorCodeSchema } from "../src/errors.js";

describe("phase 5 registry error code", () => {
  it("includes failed_attempt_already_converted", () => {
    expect(coreRegistryErrorCodeSchema.parse("failed_attempt_already_converted")).toBe(
      "failed_attempt_already_converted",
    );
  });
});
