import { describe, expect, it } from "vitest";
import { type HandoffBlockFields, renderHandoffBlockText } from "../src/handoff-block.js";
import {
  type HandoffCapabilityProfile,
  evaluateHandoffFit,
  handoffCapabilityProfileSchema,
} from "../src/handoff-capability.js";

const FIELDS: HandoffBlockFields = {
  resumeInstructions: "You are resuming a task handed off from claude-code on project demo.",
  summaryText: "# Task summary\n- [decision] use pnpm\n- TODO: finish parser",
  gitLine: "branch feat/parser @ abc1234 (dirty)",
  diffText: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
  expiresAt: "2026-08-07T12:00:00.000Z",
};

const OPEN_PROFILE: HandoffCapabilityProfile = {
  acceptsDiff: true,
  acceptsGitLine: true,
  maxBlockChars: null,
};

describe("handoffCapabilityProfileSchema", () => {
  it("accepts a valid profile and rejects a non-positive cap", () => {
    expect(handoffCapabilityProfileSchema.safeParse(OPEN_PROFILE).success).toBe(true);
    expect(
      handoffCapabilityProfileSchema.safeParse({ ...OPEN_PROFILE, maxBlockChars: 0 }).success,
    ).toBe(false);
  });
});

describe("evaluateHandoffFit", () => {
  it("passes fields through unchanged on an all-permissive profile", () => {
    expect(evaluateHandoffFit({ fields: FIELDS, profile: OPEN_PROFILE, mode: "strict" })).toEqual({
      ok: true,
      fields: FIELDS,
      dropped: [],
    });
  });

  it("strict mode refuses a forbidden diff with section_diff", () => {
    const result = evaluateHandoffFit({
      fields: FIELDS,
      profile: { ...OPEN_PROFILE, acceptsDiff: false },
      mode: "strict",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals.map((r) => r.reason)).toEqual(["section_diff"]);
  });

  it("fit mode drops diff first, then gitLine, and reports the drops", () => {
    expect(
      evaluateHandoffFit({
        fields: FIELDS,
        profile: { acceptsDiff: false, acceptsGitLine: false, maxBlockChars: null },
        mode: "fit",
      }),
    ).toEqual({
      ok: true,
      fields: { ...FIELDS, diffText: null, gitLine: null },
      dropped: ["diff", "git"],
    });
  });

  it("measures the cap on the rendered block and refuses block_too_large", () => {
    const bare: HandoffBlockFields = { ...FIELDS, gitLine: null, diffText: null };
    const rendered = renderHandoffBlockText(bare);
    const result = evaluateHandoffFit({
      fields: bare,
      profile: { ...OPEN_PROFILE, maxBlockChars: rendered.length - 1 },
      mode: "fit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals[0]?.reason).toBe("block_too_large");
  });

  it("fit mode sheds the diff to satisfy a tight cap", () => {
    const withoutDiff = renderHandoffBlockText({ ...FIELDS, diffText: null });
    const result = evaluateHandoffFit({
      fields: FIELDS,
      profile: { ...OPEN_PROFILE, maxBlockChars: withoutDiff.length },
      mode: "fit",
    });
    expect(result).toEqual({ ok: true, fields: { ...FIELDS, diffText: null }, dropped: ["diff"] });
  });

  it("strict refuses diff when profile rejects diff (brief)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: brief example uses partial fields
    const fields = { gitLine: "main", diffText: "diff...", resume: "r", summary: "s" } as any;
    const profile = { acceptsDiff: false, acceptsGitLine: true, maxBlockChars: null };
    expect(evaluateHandoffFit({ fields, profile, mode: "strict" }).ok).toBe(false);
    expect(evaluateHandoffFit({ fields, profile, mode: "fit" }).ok).toBe(true);
  });
});
