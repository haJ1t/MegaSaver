import { z } from "zod";

// Order: severity-ascending (low → critical). Human-readable progression
// for --help / error messages. Do not alphabetize.
export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export type RiskLevel = z.infer<typeof riskLevelSchema>;
