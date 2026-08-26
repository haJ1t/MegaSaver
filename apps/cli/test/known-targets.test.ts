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

  it("KNOWN_TARGETS widens to 16 (harness-autodetect set) in launch order", () => {
    expect(KNOWN_TARGETS.map((t) => t.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "aider",
      "gemini",
      "windsurf",
      "continue",
      "cline",
      "roo-code",
      "kilo-code",
      "copilot",
      "opencode",
      "amazon-q",
      "qwen",
      "trae",
      "antigravity",
    ]);
  });

  it("CLAUDE_CODE_TARGET shape matches the inline definition contract", () => {
    expect(CLAUDE_CODE_TARGET.id).toBe("claude-code");
    expect(CLAUDE_CODE_TARGET.agentId).toBe("claude-code");
    expect(CLAUDE_CODE_TARGET.relativePath).toBe("CLAUDE.md");
    expect(CLAUDE_CODE_TARGET.handoff).toEqual({
      acceptsDiff: true,
      acceptsGitLine: true,
      maxBlockChars: null,
    });
  });

  it("every known target declares a schema-valid handoff profile", async () => {
    const { handoffCapabilityProfileSchema } = await import("@megasaver/connectors-shared");
    for (const target of KNOWN_TARGETS) {
      // biome-ignore lint/suspicious/noExplicitAny: handoff is required but type narrows to unknown in generic loop
      expect(handoffCapabilityProfileSchema.safeParse((target as any).handoff).success).toBe(true);
    }
  });

  it("isKnownTargetId narrows known ids and rejects unknown ones", () => {
    expect(isKnownTargetId("claude-code")).toBe(true);
    expect(isKnownTargetId("codex")).toBe(true);
    expect(isKnownTargetId("cursor")).toBe(true);
    expect(isKnownTargetId("aider")).toBe(true);
    expect(isKnownTargetId("gemini")).toBe(true);
    expect(isKnownTargetId("windsurf")).toBe(true);
    expect(isKnownTargetId("continue")).toBe(true);
    expect(isKnownTargetId("cline")).toBe(true);
    expect(isKnownTargetId("roo-code")).toBe(true);
    expect(isKnownTargetId("kilo-code")).toBe(true);
    expect(isKnownTargetId("copilot")).toBe(true);
    expect(isKnownTargetId("opencode")).toBe(true);
    expect(isKnownTargetId("amazon-q")).toBe(true);
    expect(isKnownTargetId("qwen")).toBe(true);
    expect(isKnownTargetId("trae")).toBe(true);
    expect(isKnownTargetId("antigravity")).toBe(true);
    expect(isKnownTargetId("totally-fake")).toBe(false);
    expect(isKnownTargetId("")).toBe(false);
  });

  // NOTE: this expectTypeOf is enforced by tsconfig.test.json's `tsc -b --noEmit`
  // pass (run via `pnpm typecheck`), NOT by `vitest run` alone. vitest 2.1.x
  // without `typecheck: true` mode treats expectTypeOf as a runtime no-op.
  // pnpm verify runs both, so the type assertion holds end-to-end.
  it("KnownTargetId resolves to the closed literal union", () => {
    expectTypeOf<KnownTargetId>().toEqualTypeOf<
      | "claude-code"
      | "codex"
      | "cursor"
      | "aider"
      | "gemini"
      | "windsurf"
      | "continue"
      | "cline"
      | "roo-code"
      | "kilo-code"
      | "copilot"
      | "opencode"
      | "amazon-q"
      | "qwen"
      | "trae"
      | "antigravity"
    >();
  });
});
