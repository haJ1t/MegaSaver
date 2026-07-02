import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "@megasaver/content-store";
import type { SessionHints } from "@megasaver/output-filter";
import { MAX_SIGNATURES_PER_SESSION, extractFailureSignatures } from "./session-hints.js";

// Registry-less mirror of SessionFailure for the overlay path: failures land
// in a per-live-session JSONL file under the store root instead of a registry.
// Both text fields arrive already redacted (and capped) by the caller.
export type OverlayFailureRecord = {
  command: string;
  errorOutput: string;
  source: "proxy-classifier";
  createdAt: string;
};

// No session-end signal exists on the overlay path, so the store is bounded by
// count instead of lifecycle: append keeps only the newest records.
export const MAX_OVERLAY_FAILURES = 50;

// Same traversal guard as content-store's assertSafeSegment — copied because
// that helper is not exported from the package's public entry.
function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\")
  ) {
    throw new Error(`Unsafe overlay failure segment: ${segment}`);
  }
}

function overlayFailuresPath(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
): string {
  assertSafeSegment(workspaceKey);
  assertSafeSegment(liveSessionId);
  return join(storeRoot, "failures", workspaceKey, `${liveSessionId}.jsonl`);
}

function isOverlayFailureRecord(value: unknown): value is OverlayFailureRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    typeof v["command"] === "string" &&
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    typeof v["errorOutput"] === "string" &&
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    v["source"] === "proxy-classifier" &&
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    typeof v["createdAt"] === "string"
  );
}

export function readOverlayFailures(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
): OverlayFailureRecord[] {
  const path = overlayFailuresPath(storeRoot, workspaceKey, liveSessionId);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const records: OverlayFailureRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A corrupt line must not poison the rest of the store.
      continue;
    }
    if (isOverlayFailureRecord(parsed)) records.push(parsed);
  }
  return records;
}

export function appendOverlayFailure(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
  record: OverlayFailureRecord,
): void {
  const path = overlayFailuresPath(storeRoot, workspaceKey, liveSessionId);
  // Read → append → trim → single atomic rewrite: the count bound and the
  // append share one write so a crash never leaves a half-trimmed file.
  const kept = [...readOverlayFailures(storeRoot, workspaceKey, liveSessionId), record].slice(
    -MAX_OVERLAY_FAILURES,
  );
  atomicWriteFile(path, `${kept.map((r) => JSON.stringify(r)).join("\n")}\n`);
}

export function buildOverlayHints(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
): SessionHints {
  const signatures = new Set<string>();
  for (const failure of readOverlayFailures(storeRoot, workspaceKey, liveSessionId)) {
    for (const sig of extractFailureSignatures(failure.errorOutput)) signatures.add(sig);
  }
  return { recentFailures: [...signatures].slice(0, MAX_SIGNATURES_PER_SESSION) };
}
