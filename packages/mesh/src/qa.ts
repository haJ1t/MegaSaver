import { z } from "zod";

export const ASK_MIN_INTERVAL_MS = 60_000;

export const askPayloadSchema = z
  .object({
    askId: z.string().min(1),
    question: z.string().min(1),
    workspaceKey: z.string().regex(/^[0-9a-f]{16}$/),
    askedAtMs: z.number().int().nonnegative(),
  })
  .strict();
export type AskPayload = z.infer<typeof askPayloadSchema>;

export const answerEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chunk-set"), chunkSetId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("file-line"),
      file: z.string().min(1),
      line: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);
export type AnswerEvidence = z.infer<typeof answerEvidenceSchema>;

const answerObjectSchema = z
  .object({
    askId: z.string().min(1),
    known: z.boolean(),
    text: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    provenance: z
      .object({
        liveSessionId: z.string().min(1),
        evidence: answerEvidenceSchema,
        answeredAtMs: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const answerPayloadSchema = answerObjectSchema.superRefine((a, ctx) => {
  if (a.known && a.text.trim() === "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["text"],
      message: "known answer requires non-empty text",
    });
  }
});
export type AnswerPayload = z.infer<typeof answerObjectSchema>;
