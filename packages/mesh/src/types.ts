import { z } from "zod";

export const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const safeSegmentSchema = z.string().regex(SAFE_SEGMENT, "unsafe path segment");

const isoDateTime = z.string().datetime({ offset: true });
const workspaceKeySchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, "workspaceKey must be 16 lowercase hex chars");
const repositoryFamilyKeySchema = z
  .string()
  .regex(/^gf1_[A-Za-z0-9_-]{43}$/, "repositoryFamilyKey must be gf1_ + 43 base64url chars");

const lowercaseUuid = z
  .string()
  .uuid()
  .refine((s) => s === s.toLowerCase(), { message: "id must be lowercase" });

export const meshStatusSchema = z.enum(["working", "blocked", "idle", "done"]);
export type MeshStatus = z.infer<typeof meshStatusSchema>;

// -- Presence ---------------------------------------------------------------

export const presenceRecordSchema = z
  .object({
    liveSessionId: safeSegmentSchema,
    agent: z.string().min(1).max(64),
    status: meshStatusSchema,
    lastSeenAt: isoDateTime,
    workspaceKey: workspaceKeySchema,
    repositoryFamilyKey: repositoryFamilyKeySchema.optional(),
    cwd: z.string().min(1),
    branch: z.string().max(256).optional(),
    task: z.string().max(256).optional(),
  })
  .strict();

export type PresenceRecord = {
  liveSessionId: string;
  agent: string;
  status: "working" | "blocked" | "idle" | "done";
  lastSeenAt: string;
  workspaceKey: string;
  repositoryFamilyKey?: string;
  cwd: string;
  branch?: string;
  task?: string;
};

// -- Mesh event (bus) -------------------------------------------------------

export const meshEventKindSchema = z.enum(["message", "ask", "answer", "handoff-offer"]);
export type MeshEventKind = z.infer<typeof meshEventKindSchema>;

export const handoffOfferPointerSchema = z
  .object({
    packetPath: z.string().min(1),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
    targetAgent: z.string().min(1),
    expiresAt: isoDateTime,
    sourceProject: z.string().min(1),
  })
  .strict();

export type HandoffOfferPointer = z.infer<typeof handoffOfferPointerSchema>;

export const meshEventSchema = z
  .object({
    id: z.string().min(1),
    kind: meshEventKindSchema,
    from: z.string().min(1),
    text: z.string().min(1).max(4_000),
    createdAt: isoDateTime,
    to: z.string().min(1).optional(),
    offer: handoffOfferPointerSchema.optional(),
  })
  .strict();

export type MeshEvent = z.infer<typeof meshEventSchema>;

// -- Claims -----------------------------------------------------------------

export const claimRecordSchema = z
  .object({
    claimId: safeSegmentSchema,
    liveSessionId: safeSegmentSchema,
    workspaceKey: workspaceKeySchema,
    repositoryFamilyKey: repositoryFamilyKeySchema.optional(),
    paths: z.array(z.string().min(1).max(1_024)).min(1).max(64),
    intent: z.string().max(256).optional(),
    createdAt: isoDateTime,
    refreshedAt: isoDateTime,
    expiresAt: isoDateTime,
  })
  .strict();

export type ClaimRecord = z.infer<typeof claimRecordSchema>;

// -- Board (structured blackboard) — §13 -----------------------------------

export const boardConfidenceSchema = z.enum(["low", "medium", "high"]);
export type BoardConfidence = z.infer<typeof boardConfidenceSchema>;

export const boardFactStatusSchema = z.enum(["active", "disputed", "resolved"]);
export type BoardFactStatus = z.infer<typeof boardFactStatusSchema>;

export const boardFactIdSchema = lowercaseUuid.brand<"BoardFactId">();
export type BoardFactId = z.infer<typeof boardFactIdSchema>;

const repoRelativePath = z
  .string()
  .trim()
  .min(1)
  .refine(
    (p) => !p.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(p),
    "scope paths must be repo-relative",
  );

export const boardFactSchema = z
  .object({
    id: boardFactIdSchema,
    topic: z.string().trim().min(1),
    text: z.string().trim().min(1),
    source: z
      .object({ liveSessionId: z.string().min(1), agent: z.string().trim().min(1) })
      .strict(),
    createdAt: isoDateTime,
    confidence: boardConfidenceSchema,
    scope: z
      .object({ repoKey: z.string().min(1), paths: z.array(repoRelativePath).optional() })
      .strict(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    status: boardFactStatusSchema,
    disputedWith: z.array(boardFactIdSchema).default([]),
    resolution: z
      .object({
        byLiveSessionId: z.string().min(1),
        at: isoDateTime,
        note: z.string().optional(),
      })
      .strict()
      .optional(),
    promotedTo: z.string().min(1).optional(),
  })
  .strict();

export type BoardFact = z.infer<typeof boardFactSchema>;
