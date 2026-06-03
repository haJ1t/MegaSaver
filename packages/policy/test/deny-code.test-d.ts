import { describe, it } from "vitest";
import { type PolicyDenyCode, policyDenyCodeSchema } from "../src/deny-code.js";

describe("PolicyDenyCode type regression", () => {
  it("each of the 7 members is a valid PolicyDenyCode", () => {
    const _a: PolicyDenyCode = "command_not_allowed";
    const _b: PolicyDenyCode = "dangerous_pattern";
    const _c: PolicyDenyCode = "intent_missing";
    const _d: PolicyDenyCode = "path_denied";
    const _e: PolicyDenyCode = "policy_load_failed";
    const _f: PolicyDenyCode = "recursive_megasaver";
    const _g: PolicyDenyCode = "secret_path_read";
    void _a;
    void _b;
    void _c;
    void _d;
    void _e;
    void _f;
    void _g;
  });

  it("non-member string literal is not assignable to PolicyDenyCode", () => {
    // @ts-expect-error non-member literal is not PolicyDenyCode
    const _bad: PolicyDenyCode = "yolo";
    void _bad;
  });

  it("non-member string-cast is not assignable to PolicyDenyCode", () => {
    // @ts-expect-error arbitrary string is not assignable to PolicyDenyCode
    const _bad: PolicyDenyCode = "bogus" as string;
    void _bad;
  });

  it("policyDenyCodeSchema.options spreads into PolicyDenyCode[]", () => {
    const arr: PolicyDenyCode[] = [...policyDenyCodeSchema.options];
    void arr;
  });

  it("policyDenyCodeSchema.options is the exact alphabetic readonly tuple", () => {
    const _t: readonly [
      "command_not_allowed",
      "dangerous_pattern",
      "intent_missing",
      "path_denied",
      "policy_load_failed",
      "recursive_megasaver",
      "secret_path_read",
    ] = policyDenyCodeSchema.options;
    void _t;
  });
});
