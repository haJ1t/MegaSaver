import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("core barrel exports (phase 4)", () => {
  it("re-exports the new schemas", () => {
    expect(core.projectRuleSchema).toBeDefined();
    expect(core.failedAttemptSchema).toBeDefined();
    expect(core.ruleSeveritySchema).toBeDefined();
  });
});
