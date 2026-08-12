import { z } from "zod";
import { type HandoffBlockFields, renderHandoffBlockText } from "./handoff-block.js";

export interface HandoffCapabilityProfile {
  readonly acceptsDiff: boolean;
  readonly acceptsGitLine: boolean;
  readonly maxBlockChars: number | null;
}

export const handoffCapabilityProfileSchema: z.ZodType<HandoffCapabilityProfile> = z
  .object({
    acceptsDiff: z.boolean(),
    acceptsGitLine: z.boolean(),
    maxBlockChars: z.number().int().positive().nullable(),
  })
  .strict();

export type HandoffRefusalReason = "section_diff" | "section_git" | "block_too_large";

export interface HandoffRefusal {
  readonly reason: HandoffRefusalReason;
  readonly detail: string;
}

export type HandoffFitResult =
  | {
      readonly ok: true;
      readonly fields: HandoffBlockFields;
      readonly dropped: readonly ("diff" | "git")[];
    }
  | { readonly ok: false; readonly refusals: readonly HandoffRefusal[] };

export function evaluateHandoffFit(input: {
  fields: HandoffBlockFields;
  profile: HandoffCapabilityProfile;
  mode: "strict" | "fit";
}): HandoffFitResult {
  const { profile, mode } = input;
  let fields = input.fields;
  const dropped: ("diff" | "git")[] = [];
  const refusals: HandoffRefusal[] = [];

  if (fields.diffText !== null && !profile.acceptsDiff) {
    if (mode === "strict") {
      refusals.push({ reason: "section_diff", detail: "target does not accept a diff section" });
    } else {
      fields = { ...fields, diffText: null };
      dropped.push("diff");
    }
  }
  if (fields.gitLine !== null && !profile.acceptsGitLine) {
    if (mode === "strict") {
      refusals.push({ reason: "section_git", detail: "target does not accept a git line" });
    } else {
      fields = { ...fields, gitLine: null };
      dropped.push("git");
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };

  if (profile.maxBlockChars !== null) {
    let size = renderHandoffBlockText(fields).length;
    if (size > profile.maxBlockChars && mode === "fit") {
      if (fields.diffText !== null) {
        fields = { ...fields, diffText: null };
        dropped.push("diff");
        size = renderHandoffBlockText(fields).length;
      }
      if (size > profile.maxBlockChars && fields.gitLine !== null) {
        fields = { ...fields, gitLine: null };
        dropped.push("git");
        size = renderHandoffBlockText(fields).length;
      }
    }
    if (size > profile.maxBlockChars) {
      return {
        ok: false,
        refusals: [
          {
            reason: "block_too_large",
            detail: `rendered block is ${size} chars; target caps at ${profile.maxBlockChars}`,
          },
        ],
      };
    }
  }
  return { ok: true, fields, dropped };
}
