import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("core barrel (phase 5)", () => {
  it("re-exports the forge surface", () => {
    expect(core.searchFailedAttempts).toBeDefined();
    expect(core.rankApplicableRules).toBeDefined();
    expect(core.failureToRuleInputSchema).toBeDefined();
    expect(core.failedAttemptPatchSchema).toBeDefined();
  });
});
