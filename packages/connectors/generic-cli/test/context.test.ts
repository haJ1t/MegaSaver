import { describe, expect, it } from "vitest";
import { assertGenericCliContext } from "../src/context.js";
import { GenericCliConnectorError } from "../src/errors.js";
import { codexTarget } from "../src/targets.js";
import { buildCodexContext } from "./fixtures.js";

describe("assertGenericCliContext", () => {
  it("accepts a matching codex context", () => {
    expect(() => assertGenericCliContext(buildCodexContext(), codexTarget)).not.toThrow();
  });

  it("rejects mismatched agentId", () => {
    expect(() =>
      assertGenericCliContext(buildCodexContext({ agentId: "claude-code" }), codexTarget),
    ).toThrow(GenericCliConnectorError);
  });

  it("rejects malformed input via shared schema", () => {
    expect(() => assertGenericCliContext({}, codexTarget)).toThrow(GenericCliConnectorError);
  });
});
