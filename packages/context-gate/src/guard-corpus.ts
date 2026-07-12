import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSafeSegment, atomicWriteFile } from "@megasaver/content-store";
import { estimateTokens } from "@megasaver/output-filter";
import { z } from "zod";

// Durable, bounded, per-project auto-capture corpus for the Mistake Firewall
// (spec 2026-07-12 §3.1). Unlike SessionFailure (session-scoped, wiped on
// endSession) and overlay failures (per-live-session), these rows survive so
// the guard hook can warn across sessions. Bounded like overlay-failures:
// append keeps only the newest rows in one atomic rewrite.
export const GUARD_CORPUS_MAX = 200;

export const guardCorpusRowSchema = z
  .object({
    id: z.string().uuid(),
    command: z.string().min(1), // redacted label, argv-joined (same value SessionFailure stores)
    errorOutput: z.string(), // redacted, ≤4000 chars (caller slices, same as SessionFailure)
    wastedTokens: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type GuardCorpusRow = z.infer<typeof guardCorpusRowSchema>;

function guardCorpusPath(storeRoot: string, projectId: string): string {
  assertSafeSegment(projectId);
  return join(storeRoot, "guard", `${projectId}.failures.jsonl`);
}

export function readGuardCorpus(storeRoot: string, projectId: string): GuardCorpusRow[] {
  let raw: string;
  try {
    raw = readFileSync(guardCorpusPath(storeRoot, projectId), "utf8");
  } catch {
    return [];
  }
  const rows: GuardCorpusRow[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const checked = guardCorpusRowSchema.safeParse(parsed);
    if (checked.success) rows.push(checked.data);
  }
  return rows;
}

export function appendGuardCorpusRow(
  storeRoot: string,
  projectId: string,
  row: GuardCorpusRow,
): void {
  const checked = guardCorpusRowSchema.parse(row);
  const kept = [...readGuardCorpus(storeRoot, projectId), checked].slice(-GUARD_CORPUS_MAX);
  atomicWriteFile(
    guardCorpusPath(storeRoot, projectId),
    `${kept.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

export type CaptureGuardCorpusInput = {
  storeRoot: string;
  projectId: string;
  command: string; // already redacted by the caller
  errorOutput: string; // already redacted + capped by the caller
  raw: string; // full raw output — wastedTokens is estimated from THIS
  now: string; // ISO
};

// One-call helper for the run-command capture site: prices the failure from
// the full raw output (estimated tokens), not the 4000-char evidence slice.
export function captureGuardCorpusRow(input: CaptureGuardCorpusInput): void {
  appendGuardCorpusRow(input.storeRoot, input.projectId, {
    id: randomUUID(),
    command: input.command,
    errorOutput: input.errorOutput,
    wastedTokens: estimateTokens(input.raw),
    createdAt: input.now,
  });
}
