import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "../src/lm1-identity.js";
import type { Lm1Record } from "../src/lm1-model.js";
import { createLm2CandidateCatalog } from "../src/lm2-catalog.js";
import { lm2CandidateCatalogPath } from "../src/lm2-paths.js";

export const workspaceKey = "0123456789abcdef";

const evidenceIds = ["11111111-1111-4111-8111-111111111111"];
const evidenceDigests = ["a".repeat(64)];
const roots: string[] = [];

export function cleanupRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-catalog-")));
  roots.push(root);
  return root;
}

export function createRecord(
  index = 0,
  requestedWorkspaceKey = workspaceKey,
  text = `Billing status ${index} is paid.`,
): Lm1Record {
  const capture = {
    schemaVersion: 1 as const,
    workspaceKey: requestedWorkspaceKey,
    kind: "state_snapshot" as const,
    observedAt: new Date(Date.UTC(2026, 6, 20, 0, 0, index % 60)).toISOString(),
    text,
    action: null,
    evidenceIds,
    stateKey: `billing.status.${index}`,
    representation: "value" as const,
    supersedesSnapshotId: null,
    redactionVersion: "redaction-v1",
  };
  const sourceDigest = canonicalCaptureDigest(capture);
  return {
    ...capture,
    id: deriveLm1RecordId(requestedWorkspaceKey, "state_snapshot", sourceDigest),
    sourceDigest,
    canonicalCaptureDigest: sourceDigest,
    evidenceBindingDigest: deriveEvidenceBindingDigest({
      workspaceKey: requestedWorkspaceKey,
      canonicalCaptureDigest: sourceDigest,
      evidenceIds,
      evidenceDigests,
    }),
    recordedAt: "2026-07-20T00:00:01.000Z",
    evidenceDigests,
    status: "recorded" as const,
  };
}

export function catalogEntry(record: Lm1Record, captureSequence: number) {
  return {
    id: record.id,
    sourceDigest: record.sourceDigest,
    kind: record.kind,
    observedAt: record.observedAt,
    captureSequence,
  };
}

export function writeCatalog(
  root: string,
  entries: readonly ReturnType<typeof catalogEntry>[],
  generation = entries.length,
): void {
  createLm2CandidateCatalog({ storeRoot: root }).page({ workspaceKey, cursor: null, limit: 1 });
  const path = lm2CandidateCatalogPath(root, workspaceKey);
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 2, generation, entries })}\n`);
}

export function v2Paths(root: string) {
  const directory = join(root, "long-memory", "v1", workspaceKey, ".lm2");
  return {
    directory,
    catalog: join(directory, "candidate-catalog-v2.json"),
    control: join(directory, "candidate-catalog-v2.control.json"),
    lock: join(directory, "candidate-catalog-v2.lock"),
  };
}

export function writeV2Control(root: string): void {
  const paths = v2Paths(root);
  const stat = statSync(paths.lock);
  const token = readFileSync(paths.lock, "utf8").trim();
  const empty = `${JSON.stringify({ schemaVersion: 2, generation: 0, entries: [] })}\n`;
  writeFileSync(
    paths.control,
    `${JSON.stringify({
      schemaVersion: 2,
      catalogLock: { device: stat.dev, inode: stat.ino, token },
      emptyCatalogDigest: createHash("sha256").update(empty).digest("hex"),
    })}\n`,
    { mode: 0o600 },
  );
}
