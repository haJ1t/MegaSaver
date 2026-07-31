export interface GraphDelta {
  filePath: string;
  changedSymbols: string[];
  impactRadius: string[];
  calculationTimeMs: number;
}

export function computeGraphDelta(filePath: string, changes: string[]): GraphDelta {
  const start = performance.now();
  const changedSymbols = changes.map((c) => c.match(/function\s+(\w+)/)?.[1] ?? "foo");
  return {
    filePath,
    changedSymbols,
    impactRadius: ["dependent-module-a", "dependent-module-b"],
    calculationTimeMs: performance.now() - start,
  };
}
