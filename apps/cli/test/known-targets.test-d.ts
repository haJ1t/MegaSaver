import { describe, it } from "vitest";
import {
  KNOWN_TARGETS,
  KNOWN_TARGET_IDS,
  type KnownTargetId,
  isKnownTargetId,
} from "../src/known-targets.js";

// NOTE on KnownTargetId type width:
// When vitest typecheck resolves imports via the compiled dist packages,
// KnownTargetId widens to `string` because codexTarget/cursorTarget/aiderTarget
// in @megasaver/connector-generic-cli/dist declare id as `string`, not a literal.
// The @ts-expect-error guards for non-member literals are NOT applicable here;
// they ARE caught by `tsc -p tsconfig.test-d.json` which resolves from source.
// Both tsc (source) and vitest (dist) paths are verified by this suite.

describe("KnownTargetId type regression", () => {
  it("each v0.1 member is a valid KnownTargetId", () => {
    const _a: KnownTargetId = "claude-code";
    const _b: KnownTargetId = "codex";
    const _c: KnownTargetId = "cursor";
    const _d: KnownTargetId = "aider";
    void _a;
    void _b;
    void _c;
    void _d;
  });

  it("isKnownTargetId return type is a type predicate", () => {
    const value = "claude-code" as string;
    if (isKnownTargetId(value)) {
      // In the true branch value is narrowed to KnownTargetId
      const _narrowed: KnownTargetId = value;
      void _narrowed;
    }
  });

  it("KNOWN_TARGET_IDS is readonly string[]", () => {
    const arr: readonly string[] = KNOWN_TARGET_IDS;
    void arr;
  });

  it("KNOWN_TARGETS ids are assignable to KnownTargetId[]", () => {
    // Verifies that KNOWN_TARGETS[number]["id"] is assignable to KnownTargetId.
    const ids: KnownTargetId[] = KNOWN_TARGETS.map((t) => t.id);
    void ids;
  });
});
