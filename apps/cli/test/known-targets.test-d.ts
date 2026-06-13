import { describe, it } from "vitest";
import {
  KNOWN_TARGETS,
  KNOWN_TARGET_IDS,
  type KnownTargetId,
  isKnownTargetId,
} from "../src/known-targets.js";

describe("KnownTargetId type regression", () => {
  it("each v0.1 member is a valid KnownTargetId", () => {
    const _a: KnownTargetId = "claude-code";
    const _b: KnownTargetId = "codex";
    const _c: KnownTargetId = "cursor";
    const _d: KnownTargetId = "aider";
    const _e: KnownTargetId = "gemini";
    const _f: KnownTargetId = "windsurf";
    const _g: KnownTargetId = "continue";
    void _a;
    void _b;
    void _c;
    void _d;
    void _e;
    void _f;
    void _g;
  });

  it("non-member literal is not assignable to KnownTargetId", () => {
    // @ts-expect-error non-member literal is rejected by the closed union
    const _bad: KnownTargetId = "non-member-id";
    void _bad;
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
