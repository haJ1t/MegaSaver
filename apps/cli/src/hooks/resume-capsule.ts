import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { TASK_KICKOFF_CHARACTER_CAP, TASK_KICKOFF_TOKEN_CAP } from "./task-kickoff-pack.js";
import { isSafeHookSessionId } from "./task-kickoff-store.js";

export const RESUME_CAPSULE_FILENAME = "resume-capsule.json";
export const RESUME_CAPSULE_MAX_AGE_MS = 24 * 60 * 60_000;

const resumeCapsuleSchema = z
  .object({
    version: z.literal(1),
    sourceSessionId: z.string().min(1),
    text: z.string().min(1).max(TASK_KICKOFF_CHARACTER_CAP),
    tokenCount: z.number().int().nonnegative().max(TASK_KICKOFF_TOKEN_CAP),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export type ResumeCapsule = z.infer<typeof resumeCapsuleSchema>;

export function resumeCapsulePath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKeySchema.parse(workspaceKey), RESUME_CAPSULE_FILENAME);
}

export function writeResumeCapsule(
  storeRoot: string,
  workspaceKey: string,
  capsule: ResumeCapsule,
): void {
  const path = resumeCapsulePath(storeRoot, workspaceKey);
  const validated = resumeCapsuleSchema.parse(capsule);
  const dir = dirname(path);
  // Owner-only: the capsule holds redacted-but-private working context.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(validated)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Rename-claim: the rename is the at-most-once gate — the first consumer wins
// and every later caller sees ENOENT. Stale or malformed capsules are removed
// rather than delivered (prefer-loss, amendment 2026-08-01 §1 posture).
export function consumeResumeCapsule(
  storeRoot: string,
  workspaceKey: string,
  claimingSessionId: string,
  now: () => number = Date.now,
): ResumeCapsule | null {
  if (!isSafeHookSessionId(claimingSessionId)) return null;
  try {
    const path = resumeCapsulePath(storeRoot, workspaceKey);
    const claimed = join(
      dirname(path),
      `.resume-capsule-consumed-${claimingSessionId}.json`,
    );
    renameSync(path, claimed); // throws ENOENT when nothing is pending
    let raw: string;
    try {
      raw = readFileSync(claimed, "utf8");
    } finally {
      rmSync(claimed, { force: true });
    }
    const parsed = resumeCapsuleSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (now() - parsed.data.createdAt > RESUME_CAPSULE_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
