export function osaDistanceAtMost(a: string, b: string, max: number): number | null {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return null;
  let prev2: number[] | null = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      if (prev2 !== null && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2[j - 2] as number) + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return null;
    prev2 = prev;
    prev = cur;
  }
  const d = prev[b.length] as number;
  return d <= max ? d : null;
}

export function nearestKnownName(name: string, known: readonly string[]): string | null {
  if (known.includes(name)) return null;
  let best: { name: string; distance: number } | null = null;
  for (const candidate of known) {
    // Architect m8: hints fire at OSA distance 1 only — distance 2 against
    // short seed names manufactures nonsense hints.
    const distance = osaDistanceAtMost(name, candidate, 1);
    if (distance === null || distance !== 1) continue;
    if (best === null || candidate.localeCompare(best.name) < 0) {
      best = { name: candidate, distance };
    }
  }
  return best?.name ?? null;
}
