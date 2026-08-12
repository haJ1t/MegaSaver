import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export type ExecGit = (args: string[], cwd: string, input?: string) => string;

export const reviewVerdictSchema = z.enum(["approve", "request-changes", "needs-work"]);
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const reviewAttestationSchema = z
  .object({
    diffHash: z.string().length(64),
    baseRef: z.string().min(1),
    headRef: z.string().min(1),
    verdict: reviewVerdictSchema,
    reviewerLabel: z.string().min(1),
    note: z.string().optional(),
    reviewPackId: z.string().optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ReviewAttestation = z.infer<typeof reviewAttestationSchema>;

function defaultExecGit(args: string[], cwd: string, input?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 10_000,
    maxBuffer: 50 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
}

export function computeDiffHash(
  range: string,
  cwd: string,
  execGit: ExecGit = defaultExecGit,
): string {
  const raw = execGit(["diff", "--no-color", range], cwd);
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function attestationLogPath(storeRoot: string, projectId: string): string {
  return join(storeRoot, "review-attestation", projectId, "attestations.jsonl");
}

export function appendAttestation(
  storeRoot: string,
  projectId: string,
  record: ReviewAttestation,
): void {
  const parsed = reviewAttestationSchema.parse(record);
  const path = attestationLogPath(storeRoot, projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(parsed)}\n`);
}

export function readAttestations(storeRoot: string, projectId: string): ReviewAttestation[] {
  let raw: string;
  try {
    raw = readFileSync(attestationLogPath(storeRoot, projectId), "utf8");
  } catch {
    return [];
  }
  const rows: ReviewAttestation[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = reviewAttestationSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) rows.push(parsed.data);
    } catch {
      // skip malformed line
    }
  }
  return rows;
}
