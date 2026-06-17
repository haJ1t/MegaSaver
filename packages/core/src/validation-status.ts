import { z } from "zod";

// The deterministic outcome of save validation, distinct from the approval
// lifecycle (suggested/approved/rejected). `valid` is the only state that
// permits an approve flip; everything else routes to human review or rejection.
export const validationStatusSchema = z.enum([
  "unvalidated",
  "valid",
  "needs_approval",
  "quarantined",
  "rejected",
]);
export type ValidationStatus = z.infer<typeof validationStatusSchema>;
