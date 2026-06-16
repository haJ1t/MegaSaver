import { z } from "zod";

export const eligibilityClassSchema = z.enum(["eligible", "passthrough", "native_observed"]);
export type EligibilityClass = z.infer<typeof eligibilityClassSchema>;

export const mediationKindSchema = z.enum(["proxy", "saver_hook", "native"]);
export type MediationKind = z.infer<typeof mediationKindSchema>;

export const honestObservationSchema = z
  .object({
    rawTokens: z.number().int().nonnegative(),
    returnedTokens: z.number().int().nonnegative(),
    eligibility: eligibilityClassSchema,
    mediation: mediationKindSchema,
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.returnedTokens > o.rawTokens) {
      ctx.addIssue({ code: "custom", message: "returnedTokens must not exceed rawTokens.", path: ["returnedTokens"] });
    }
  });
export type HonestObservation = z.infer<typeof honestObservationSchema>;
