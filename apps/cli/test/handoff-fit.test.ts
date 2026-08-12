import type { HandoffFitResult } from "@megasaver/connectors-shared";
import { describe, expect, it } from "vitest";
import { handoffFieldsFromPacket, handoffFitVerdictLine } from "../src/commands/handoff/shared.js";

const OK: HandoffFitResult = {
  ok: true,
  fields: {
    resumeInstructions: "resume",
    summaryText: "summary",
    gitLine: null,
    diffText: null,
    expiresAt: "2026-08-07T12:00:00.000Z",
  },
  dropped: [],
};

describe("handoffFitVerdictLine", () => {
  it("prints ok for a fitting packet", () => {
    expect(handoffFitVerdictLine("codex", OK)).toBe("fit(codex): ok");
  });

  it("prints the refusal reasons and the --fit remedy", () => {
    const refused: HandoffFitResult = {
      ok: false,
      refusals: [{ reason: "section_diff", detail: "target does not accept a diff section" }],
    };
    expect(handoffFitVerdictLine("aider", refused)).toBe(
      "fit(aider): open will refuse (section_diff) — receiver may pass --fit",
    );
  });
});

describe("handoffFieldsFromPacket", () => {
  it("maps packet sections onto block fields", () => {
    expect(
      handoffFieldsFromPacket({
        manifest: { expiresAt: "2026-08-07T12:00:00.000Z" },
        payload: {
          resumeInstructions: "resume",
          taskSummary: { text: "summary" },
          git: {
            branch: "main",
            headSha: null,
            dirty: false,
            diff: { text: "diff --git" },
          },
        },
      }),
    ).toEqual({
      resumeInstructions: "resume",
      summaryText: "summary",
      gitLine: "branch main",
      diffText: "diff --git",
      expiresAt: "2026-08-07T12:00:00.000Z",
    });
  });
});
