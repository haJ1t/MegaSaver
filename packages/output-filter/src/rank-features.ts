import { z } from "zod";

export const rankFeatureNameSchema = z.enum([
  "diagnosticScore",
  "duplicatePenalty",
  "errorScore",
  "filePathScore",
  "keywordScore",
  "noisePenalty",
  "recentFileScore",
  "stackTraceScore",
  "testFailureScore",
]);

export type RankFeatureName = z.infer<typeof rankFeatureNameSchema>;
