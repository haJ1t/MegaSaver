// Clamp a numeric query param to a sane range; returns fallback when absent or
// malformed. Used by the paginated list routes (memory, index search). First
// surface is limit+offset (§5) — a JSON file store makes real cursors costly.
export function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
