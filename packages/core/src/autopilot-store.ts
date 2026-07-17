import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { memoryTypeSchema } from "./memory-entry.js";

// Store-root policy + digest state for Brain Autopilot (spec §4.1/§4.2).
// Pattern cloned from guard-state.ts: tmp+rename write, no fsync, concurrent
// writers last-writer-wins. One difference: reads FAIL CLOSED to a default
// instead of null — a missing or corrupt policy can never enable
// auto-approval, and a corrupt digest state only widens the "since" header.
const autopilotPolicySchema = z
  .object({
    enabled: z.boolean(),
    autoApproveTypes: z.array(memoryTypeSchema),
    // Floor AND ceiling, not a tunable threshold: `high` is the only confidence
    // that may ever auto-approve. Named for the concept it gates, not for the
    // range it may hold — widening this to memoryConfidenceSchema (low/medium/
    // high) would silently let `medium` candidates write approved rows unattended.
    autoApproveMinConfidence: z.literal("high"),
    maxAutoApprovesPerSession: z.number().int().positive(),
  })
  .strict();

export type AutopilotPolicy = z.infer<typeof autopilotPolicySchema>;

// `decision` is deliberately NOT defaulted — human-stated decisions deserve
// human approval. bug/test_behavior are the only types the extractor emits
// from failures (architect B1: failed_attempt is the SOURCE row kind, never
// a candidate type).
export const DEFAULT_AUTOPILOT_POLICY: AutopilotPolicy = {
  enabled: false,
  autoApproveTypes: ["bug", "test_behavior"],
  autoApproveMinConfidence: "high",
  maxAutoApprovesPerSession: 10,
};

const digestStateSchema = z
  .object({
    lastDigestAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type DigestState = z.infer<typeof digestStateSchema>;

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(storeRoot: string, fileName: string, data: unknown): void {
  try {
    mkdirSync(storeRoot, { recursive: true });
    const tmp = join(storeRoot, `.${randomUUID()}.tmp`);
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, join(storeRoot, fileName));
  } catch {
    // best-effort like guard-state: a lost write fails closed (autopilot
    // stays disabled / digest header falls back to null) — corruption is
    // what tmp+rename prevents.
  }
}

export function readAutopilotPolicy(storeRoot: string): AutopilotPolicy {
  const parsed = autopilotPolicySchema.safeParse(readJsonFile(join(storeRoot, "autopilot.json")));
  // Deep copy, never the singleton itself: a caller mutating a returned default
  // (T7's `autopilot on` is read-modify-write) would otherwise flip the constant
  // to enabled for every later read in the process, including corrupt-file reads.
  return parsed.success ? parsed.data : structuredClone(DEFAULT_AUTOPILOT_POLICY);
}

export function writeAutopilotPolicy(storeRoot: string, policy: AutopilotPolicy): void {
  writeJsonAtomic(storeRoot, "autopilot.json", policy);
}

export function readDigestState(storeRoot: string): DigestState {
  const parsed = digestStateSchema.safeParse(readJsonFile(join(storeRoot, "digest-state.json")));
  return parsed.success ? parsed.data : { lastDigestAt: null };
}

export function writeDigestState(storeRoot: string, state: DigestState): void {
  writeJsonAtomic(storeRoot, "digest-state.json", state);
}
