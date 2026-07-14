import {
  memoryEntryIdSchema,
  projectIdSchema,
  sessionIdSchema,
  titleSchema,
} from "@megasaver/shared";
import { z } from "zod";
import { codeAnchorSchema, lastVerifiedSchema } from "./memory-anchor.js";

// Order: semantic — project precedes session because sessions belong to
// projects (containment hierarchy). Used for derived CLI strings.
export const memoryScopeSchema = z.enum(["project", "session"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

// Order: the ten engineering-memory categories, in roadmap declaration
// order (Phase 1 DIMMEM). AA3 convention: declaration order is a contract.
export const memoryTypeSchema = z.enum([
  "decision",
  "bug",
  "architecture",
  "todo",
  "user_preference",
  "failed_attempt",
  "code_pattern",
  "project_rule",
  "dependency",
  "test_behavior",
]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

// Order: ascending trust.
export const memoryConfidenceSchema = z.enum(["low", "medium", "high"]);
export type MemoryConfidence = z.infer<typeof memoryConfidenceSchema>;

// Tier (M2, Letta/MemGPT-class working/recall/archival). Order: activity-
// descending — `working` (active/recent, a small recall boost), `recall` (the
// normal default), `archival` (aged-out/low-value, excluded from recall unless
// asked for). Optional + additive: an absent tier reads as `recall`, so every
// legacy/normal row keeps its current behavior (back-compat).
export const memoryTierSchema = z.enum(["working", "recall", "archival"]);
export type MemoryTier = z.infer<typeof memoryTierSchema>;

// Order: where the memory came from, roadmap order.
export const memorySourceSchema = z.enum([
  "manual",
  "agent",
  "test_failure",
  "git_diff",
  "session_summary",
]);
export type MemorySource = z.infer<typeof memorySourceSchema>;

// Order: lifecycle — `suggested` (proposed, usually by an agent), then a human
// moves it to `approved` (shared with agents/teammates) or `rejected` (kept for
// audit, never shared). Declaration order is the lifecycle, NOT alphabetic:
// `approved` is the steady state the gate admits and reads most. AA3 convention:
// declaration order is a contract — do not reorder.
export const memoryApprovalSchema = z.enum(["suggested", "approved", "rejected"]);
export type MemoryApproval = z.infer<typeof memoryApprovalSchema>;

// Keywords are a retrieval surface (BM25 over title+content+keywords), so
// they are normalized to a stable form: lowercased, trimmed, de-duplicated,
// empties dropped. Order of first appearance is preserved.
const keywordsSchema = z.array(z.string()).transform((raw) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
});

export const memoryEntrySchema = z
  .object({
    id: memoryEntryIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema.nullable(),
    scope: memoryScopeSchema,
    type: memoryTypeSchema,
    title: titleSchema,
    content: z.string().trim().min(1),
    keywords: keywordsSchema,
    confidence: memoryConfidenceSchema,
    source: memorySourceSchema,
    approval: memoryApprovalSchema.default("approved"),
    reason: z.string().trim().min(1).optional(),
    goal: z.string().trim().min(1).optional(),
    evidence: z.array(z.string()).optional(),
    relatedFiles: z.array(z.string()).optional(),
    relatedSymbols: z.array(z.string()).optional(),
    stale: z.boolean().default(false),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    // Bi-temporal valid-time (M1). createdAt/updatedAt are TRANSACTION time (when
    // we recorded it); validFrom/validTo are VALID time (when the fact is true in
    // the world). Absent validFrom ⇒ no lower bound; absent/null validTo ⇒ still
    // valid. A row with neither bound is current — keeps every legacy/normal row
    // current (back-compat).
    validFrom: z.string().datetime({ offset: true }).optional(),
    validTo: z.string().datetime({ offset: true }).nullable().optional(),
    supersedesId: memoryEntryIdSchema.optional(),
    // Decay rekey (Living Brain): last time the CONTENT was touched. Set at
    // create by writers and by `mega memory update` on content-bearing
    // patches; approval flips and sweeps bump updatedAt but never this field.
    // Absent on legacy rows ⇒ decay falls back to updatedAt (bit-identical
    // pre-rekey behavior).
    lastActiveAt: z.string().datetime({ offset: true }).optional(),
    // M2 tier. Absent ⇒ recall (see memoryTierSchema). Only the explicit sweep
    // mutates it; recall hides `archival` by default.
    tier: memoryTierSchema.optional(),
    // Code-truth (i6): git anchor captured at save + verification stamp.
    // Optional + additive — legacy rows parse untouched.
    anchor: codeAnchorSchema.optional(),
    lastVerified: lastVerifiedSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === null) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires sessionId.",
        path: ["sessionId"],
      });
    }

    if (entry.scope === "project" && entry.sessionId !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Project-scoped memory cannot include sessionId.",
        path: ["sessionId"],
      });
    }
  });

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

// Bi-temporal valid-time check (M1): is the memory's fact true at `asOf`?
// Lower bound inclusive, upper bound exclusive (half-open: [validFrom, validTo)),
// so a memory closed at T and its successor opened at T do not both read current
// at exactly T. Absent validFrom ⇒ no lower bound; absent/null validTo ⇒ open.
// Compared as epoch millis to be offset-agnostic. `asOf` is an ISO-8601 datetime.
export function isCurrent(
  memory: Pick<MemoryEntry, "validFrom" | "validTo">,
  asOf: string,
): boolean {
  const at = Date.parse(asOf);
  if (memory.validFrom !== undefined && at < Date.parse(memory.validFrom)) return false;
  if (memory.validTo != null && at >= Date.parse(memory.validTo)) return false;
  return true;
}

// M2: a memory's tier, defaulting an absent field to `recall`. One place so the
// "absent ⇒ recall" rule cannot drift.
export function tierOf(memory: Pick<MemoryEntry, "tier">): MemoryTier {
  return memory.tier ?? "recall";
}

// M2: archival is the only tier hidden from default recall.
export function isArchived(memory: Pick<MemoryEntry, "tier">): boolean {
  return tierOf(memory) === "archival";
}

// The shared recall predicate: a memory is recallable iff it is approved, is
// currently valid at `asOf`, AND (M2) is not archival — unless includeArchival
// is set. Every recall surface (BM25/semantic search, the MCP recall tool, the
// daemon recall handler, connector context) routes its approval+validity+tier
// gate through this ONE function so neither the bi-temporal filter (M1) nor the
// tier filter (M2) can silently drift between surfaces. Scope/session matching
// stays per-caller (it is not the part that drifted). Stale is gated separately
// by the searches.
export function isRecallable(
  memory: Pick<MemoryEntry, "approval" | "validFrom" | "validTo" | "tier">,
  asOf: string,
  options?: { includeArchival?: boolean },
): boolean {
  if (memory.approval !== "approved") return false;
  if (!isCurrent(memory, asOf)) return false;
  if (options?.includeArchival !== true && isArchived(memory)) return false;
  return true;
}

// M2 decay weights. baseWeight: ascending trust (low/medium/high). tierWeight:
// the working set gets a small recall boost; recall/archival are neutral (so a
// down-ranked archival surfaced via includeArchival still sorts sanely).
const CONFIDENCE_WEIGHT: Record<MemoryConfidence, number> = {
  low: 0.34,
  medium: 0.67,
  high: 1,
};
const TIER_WEIGHT: Record<MemoryTier, number> = {
  working: 1.1,
  recall: 1,
  archival: 1,
};
// Exponential age decay with a 30-day half-life. Pure: `now` and the memory's
// timestamps are passed in, never read from a wall clock — so ranking is
// deterministic and tests pin time. age ≤ 0 ⇒ factor 1 (a future/just-written
// memory is not penalized). Floored above 0 so decay only DOWN-RANKS, never
// drops a memory to a zero weight.
const DECAY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
function ageDecay(ageMs: number): number {
  if (ageMs <= 0) return 1;
  return 2 ** (-ageMs / DECAY_HALF_LIFE_MS);
}

// M2: effective confidence for RANKING only — a pure read-time function that
// never mutates the stored `confidence`. effective = baseWeight(confidence) ×
// ageDecay(now − lastActiveAt) × tierWeight(tier), falling back to updatedAt
// then createdAt for legacy rows (bit-identical pre-rekey ordering). Approval
// flips and sweeps bump updatedAt but never lastActiveAt, so they no longer
// reset a memory's age. Older memories rank lower; the working tier ranks
// slightly higher. Always > 0, so a current memory is only ever DOWN-RANKED
// by decay, never dropped. `now` is an ISO-8601 datetime.
export function effectiveConfidence(
  memory: Pick<MemoryEntry, "confidence" | "tier" | "createdAt" | "updatedAt" | "lastActiveAt">,
  now: string,
): number {
  const at = Date.parse(now);
  const ref = Date.parse(memory.lastActiveAt ?? memory.updatedAt ?? memory.createdAt);
  // A NaN from either parse ⇒ no decay (factor 1) rather than a NaN weight that
  // would corrupt the ranking sort. Ranking degrades gracefully; it never breaks.
  const factor = Number.isNaN(at) || Number.isNaN(ref) ? 1 : ageDecay(at - ref);
  return CONFIDENCE_WEIGHT[memory.confidence] * factor * TIER_WEIGHT[tierOf(memory)];
}

// M2 sweep policy. A memory is swept to `archival` when it is currently NOT
// working/archival and it is past its usefulness: already closed/superseded
// (validTo before now), OR stale, OR low base confidence AND inactive for at
// least `maxIdleMs`. The working tier is the active set and is never swept;
// archival is already there (idempotent). Lossless — the planner only names ids;
// the caller demotes via tier, never deletes.
export type SweepPolicy = { maxIdleMs: number };
const DEFAULT_SWEEP_MAX_IDLE_MS = 90 * 24 * 60 * 60 * 1000;
export const DEFAULT_SWEEP_POLICY: SweepPolicy = { maxIdleMs: DEFAULT_SWEEP_MAX_IDLE_MS };

export function sweepMemoryTiers(
  entries: readonly MemoryEntry[],
  now: string,
  policy: SweepPolicy = DEFAULT_SWEEP_POLICY,
): { archiveIds: MemoryEntry["id"][] } {
  const at = Date.parse(now);
  // Fail loud: a malformed `now` would make every comparison NaN-false and
  // silently archive nothing. The sweep is the ONLY mutation — a silent no-op on
  // bad input is the worst outcome, so reject it at this boundary.
  if (Number.isNaN(at)) throw new TypeError(`sweepMemoryTiers: invalid now: ${now}`);
  const archiveIds: MemoryEntry["id"][] = [];
  for (const entry of entries) {
    const tier = tierOf(entry);
    if (tier === "working" || tier === "archival") continue;
    const closed = entry.validTo != null && at >= Date.parse(entry.validTo);
    const idleMs = at - Date.parse(entry.updatedAt ?? entry.createdAt);
    const idleLowValue = entry.confidence === "low" && idleMs >= policy.maxIdleMs;
    if (closed || entry.stale || idleLowValue) archiveIds.push(entry.id);
  }
  return { archiveIds };
}

// F4 live-first variant: drops the (projectId, sessionId) FK pair for the
// cwd-derived workspaceKey + the Claude transcript liveSessionId. The `scope`
// invariant now binds liveSessionId: "session" ⇒ conversation-scoped (non-null),
// "project" ⇒ cwd/workspace-scoped cross-session (null). The "project" wire value
// is retained for type-compat; it semantically means workspace-scoped now (F5
// renames the enum). `.strict()` rejects any leftover projectId/sessionId.
export const overlayMemoryEntrySchema = z
  .object({
    id: memoryEntryIdSchema,
    workspaceKey: z.string().min(1),
    liveSessionId: z.string().nullable(),
    scope: memoryScopeSchema,
    type: memoryTypeSchema,
    title: titleSchema,
    content: z.string().trim().min(1),
    keywords: keywordsSchema,
    confidence: memoryConfidenceSchema,
    source: memorySourceSchema,
    approval: memoryApprovalSchema.default("approved"),
    reason: z.string().trim().min(1).optional(),
    goal: z.string().trim().min(1).optional(),
    evidence: z.array(z.string()).optional(),
    relatedFiles: z.array(z.string()).optional(),
    relatedSymbols: z.array(z.string()).optional(),
    stale: z.boolean().default(false),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    validFrom: z.string().datetime({ offset: true }).optional(),
    validTo: z.string().datetime({ offset: true }).nullable().optional(),
    supersedesId: memoryEntryIdSchema.optional(),
    // Decay rekey (Living Brain): last time the CONTENT was touched. Set at
    // create by writers and by `mega memory update` on content-bearing
    // patches; approval flips and sweeps bump updatedAt but never this field.
    // Absent on legacy rows ⇒ decay falls back to updatedAt (bit-identical
    // pre-rekey behavior).
    lastActiveAt: z.string().datetime({ offset: true }).optional(),
    // M2 tier. Absent ⇒ recall (see memoryTierSchema). Only the explicit sweep
    // mutates it; recall hides `archival` by default.
    tier: memoryTierSchema.optional(),
    // Code-truth (i6): git anchor captured at save + verification stamp.
    // Optional + additive — legacy rows parse untouched.
    anchor: codeAnchorSchema.optional(),
    lastVerified: lastVerifiedSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.liveSessionId === null) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires liveSessionId.",
        path: ["liveSessionId"],
      });
    }

    if (entry.scope === "project" && entry.liveSessionId !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace-scoped memory cannot include liveSessionId.",
        path: ["liveSessionId"],
      });
    }
  });

export type OverlayMemoryEntry = z.infer<typeof overlayMemoryEntrySchema>;

// Partial update over the MUTABLE fields only. id/projectId/createdAt/scope/
// sessionId are immutable after create; `.strict()` rejects them so a bad
// caller fails loudly. `updatedAt` is required — the caller (CLI/MCP) owns the
// clock, mirroring the create path where timestamps are passed in, not minted
// inside the registry.
export const memoryEntryUpdatePatchSchema = z
  .object({
    type: memoryTypeSchema.optional(),
    title: titleSchema.optional(),
    content: z.string().trim().min(1).optional(),
    keywords: keywordsSchema.optional(),
    confidence: memoryConfidenceSchema.optional(),
    source: memorySourceSchema.optional(),
    approval: memoryApprovalSchema.optional(),
    reason: z.string().trim().min(1).optional(),
    goal: z.string().trim().min(1).optional(),
    evidence: z.array(z.string()).optional(),
    relatedFiles: z.array(z.string()).optional(),
    relatedSymbols: z.array(z.string()).optional(),
    stale: z.boolean().optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    // validTo is patchable so the supersede gate can close a memory's validity
    // (validFrom/supersedesId are set at create and immutable, like the key cols).
    validTo: z.string().datetime({ offset: true }).nullable().optional(),
    // lastActiveAt is patchable so content-bearing updates can re-key decay.
    lastActiveAt: z.string().datetime({ offset: true }).optional(),
    // tier is patchable so `mega memory sweep` can demote a memory to archival.
    tier: memoryTierSchema.optional(),
    // anchor/lastVerified are patchable so code-truth verify can stamp results
    // and repoint renamed paths (updateMemoryEntry re-parses the full entry —
    // omitting these here would make every verify mutation a Zod rejection).
    anchor: codeAnchorSchema.optional(),
    lastVerified: lastVerifiedSchema.optional(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type MemoryEntryUpdatePatch = z.infer<typeof memoryEntryUpdatePatchSchema>;

// The overlay variant mutates the same fields — only the immutable key columns
// differ (workspaceKey/liveSessionId vs projectId/sessionId), and neither is
// patchable — so the mutable-field patch is identical.
export const overlayMemoryEntryUpdatePatchSchema = memoryEntryUpdatePatchSchema;

export type OverlayMemoryEntryUpdatePatch = z.infer<typeof overlayMemoryEntryUpdatePatchSchema>;

const LEGACY_TITLE_MAX = 59;

// v0.1 memory rows predate the typed DIMMEM schema. Backfill them to neutral
// defaults at the read boundary so existing on-disk stores keep loading.
export function backfillMemoryEntry(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") {
    return raw;
  }
  // Phase 10: any row predating the approval field defaults to `approved` so
  // existing shared memory keeps flowing through the gate. INDEPENDENT of the
  // legacy-type upgrade below — typed Phase 1–9 rows also lack `approval`.
  const withApproval =
    "approval" in raw ? raw : { ...(raw as Record<string, unknown>), approval: "approved" };

  if ("type" in withApproval) {
    return withApproval;
  }
  const entry = withApproval as { content?: unknown; createdAt?: unknown };
  // A real v0.1 row always carried `createdAt`. A row without it is corrupt, not
  // legacy — leave it (sans fabricated timestamp) so the schema rejects it loudly.
  if (typeof entry.createdAt !== "string") {
    return withApproval;
  }
  const content = typeof entry.content === "string" ? entry.content : "";
  const title = content.trim().slice(0, LEGACY_TITLE_MAX) || "untitled";
  return {
    ...(withApproval as Record<string, unknown>),
    type: "todo",
    title,
    keywords: [],
    confidence: "low",
    source: "manual",
    stale: false,
    updatedAt: entry.createdAt,
  };
}
