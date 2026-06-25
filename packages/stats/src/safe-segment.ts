import { StatsError } from "./errors.js";

// A path segment is safe when it cannot escape its parent directory. Mirrors
// content-store's assertSafeSegment so @megasaver/stats stays a leaf package
// (no @megasaver/core dependency just for this guard). Overlay keys
// (workspaceKey, liveSessionId) are interpolated into the on-disk stats path,
// so an unchecked `..` / `/` lets a caller write outside the store root.
export function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes("\0")
  );
}

export function assertSafeSegment(segment: string): void {
  if (!isSafeSegment(segment)) {
    throw new StatsError("write_failed", `Unsafe path segment: ${segment}`);
  }
}
