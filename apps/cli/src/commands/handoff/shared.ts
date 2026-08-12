import type { KeyObject } from "node:crypto";
import type { HandoffBlockFields, HandoffFitResult } from "@megasaver/connectors-shared";
import { agentSlugSchema } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { PRO_ANALYTICS_URL } from "../savings/index.js";

export const HANDOFF_UPSELL = `Hot handoff is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Single size lever for open + inspect, both of which run the shared (quadratic)
// redaction pass over attacker-controlled packet text. An honest packet's
// worst case is well under ~128KB: resume brief ≤2000 tok (~8KB) + task summary
// ≤8000 tok (~32KB) + diff ≤HANDOFF_DIFF_TOKEN_CAP 2000 tok (~8KB) + ≤20
// memories + ≤10 failures (content/evidence, ~a few KB each). 512KB caps the
// worst-case redaction well under 1s (1MB ≈ 1.1s, quadratic) while leaving ~4x
// headroom over that ceiling; a hostile MB-scale packet is refused before read.
export const MAX_PACKET_BYTES = 512 * 1024;

// A "verified" badge means the SENDER anchored it — never a check against this
// repo — so both the open and inspect renderers must qualify it or the reader
// infers false trust.
export const HANDOFF_BADGE_NOTE =
  "badges reflect sender-supplied anchors, not yet checked against this repo";

export type HandoffGateInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  stdout: (line: string) => void;
};

export function gate(input: HandoffGateInput): boolean {
  const ent = checkEntitlement("hot-handoff", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(HANDOFF_UPSELL);
    return false;
  }
  return true;
}

// Count capped at 5 digits (99999h ≈ 11.4y): unbounded counts overflow the
// Date range and toISOString throws instead of a clean flag error.
const EXPIRES_PATTERN = /^([1-9]\d{0,4})([hd])$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// serializeHandoffPacket validates the manifest, so a non-slug --from throws
// inside the packer — reject it at the CLI boundary for a clean error instead of
// an uncaught ZodError. Reuses core's agentSlugSchema so the shape can't drift.
export function isAgentSlug(value: string): boolean {
  return agentSlugSchema.safeParse(value).success;
}

// null = malformed flag; the caller owns the exit-1 message (runCache --days precedent).
export function parseExpires(raw: string | undefined, now: number): number | null {
  if (raw === undefined) return now + DAY_MS;
  const match = EXPIRES_PATTERN.exec(raw);
  if (match === null) return null;
  const [, count, unit] = match;
  if (count === undefined || unit === undefined) return null;
  return now + Number.parseInt(count, 10) * (unit === "h" ? HOUR_MS : DAY_MS);
}

// Extracted from open.ts's inline gitLineRaw so open/pack/peers share one formula.
export function handoffGitLine(
  git: { branch: string | null; headSha: string | null; dirty: boolean } | null,
): string | null {
  if (git === null) return null;
  return `branch ${git.branch}${git.headSha === null ? "" : ` @ ${git.headSha}`}${git.dirty ? " (dirty)" : ""}`;
}

export function handoffFieldsFromPacket(packet: {
  manifest: { expiresAt: string };
  payload: {
    resumeInstructions: string;
    taskSummary: { text: string };
    git: {
      branch: string | null;
      headSha: string | null;
      dirty: boolean;
      diff: { text: string } | null;
    } | null;
  };
}): HandoffBlockFields {
  const git = packet.payload.git;
  return {
    resumeInstructions: packet.payload.resumeInstructions,
    summaryText: packet.payload.taskSummary.text,
    gitLine: handoffGitLine(git),
    diffText: git === null || git.diff === null ? null : git.diff.text,
    expiresAt: packet.manifest.expiresAt,
  };
}

export function handoffFitVerdictLine(targetId: string, result: HandoffFitResult): string {
  if (result.ok) return `fit(${targetId}): ok`;
  const reasons = result.refusals.map((r) => r.reason).join(", ");
  return `fit(${targetId}): open will refuse (${reasons}) — receiver may pass --fit`;
}
