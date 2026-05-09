import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CLAUDE_CODE_TARGET,
  KNOWN_TARGETS,
  KNOWN_TARGET_IDS,
  type KnownTargetId,
  isKnownTargetId,
} from "../src/known-targets.js";

describe("known-targets", () => {
  it("KNOWN_TARGET_IDS derives from KNOWN_TARGETS in launch order", () => {
    expect(KNOWN_TARGET_IDS).toEqual(KNOWN_TARGETS.map((t) => t.id));
  });

  it("KNOWN_TARGETS includes claude-code, codex, cursor, aider in launch order", () => {
    expect(KNOWN_TARGETS.map((t) => t.id)).toEqual(["claude-code", "codex", "cursor", "aider"]);
  });

  it("CLAUDE_CODE_TARGET shape matches the inline definition contract", () => {
    expect(CLAUDE_CODE_TARGET.id).toBe("claude-code");
    expect(CLAUDE_CODE_TARGET.agentId).toBe("claude-code");
    expect(CLAUDE_CODE_TARGET.relativePath).toBe("CLAUDE.md");
  });

  it("isKnownTargetId narrows known ids and rejects unknown ones", () => {
    expect(isKnownTargetId("claude-code")).toBe(true);
    expect(isKnownTargetId("codex")).toBe(true);
    expect(isKnownTargetId("cursor")).toBe(true);
    expect(isKnownTargetId("aider")).toBe(true);
    expect(isKnownTargetId("totally-fake")).toBe(false);
    expect(isKnownTargetId("")).toBe(false);
  });

  // NOTE: this expectTypeOf is enforced by tsconfig.test.json's `tsc -b --noEmit`
  // pass (run via `pnpm typecheck`), NOT by `vitest run` alone. vitest 2.1.x
  // without `typecheck: true` mode treats expectTypeOf as a runtime no-op.
  // pnpm verify runs both, so the type assertion holds end-to-end.
  it("KnownTargetId resolves to the closed literal union", () => {
    expectTypeOf<KnownTargetId>().toEqualTypeOf<"claude-code" | "codex" | "cursor" | "aider">();
  });
});
