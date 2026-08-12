import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContractResult } from "@megasaver/memory-recall";
import { withFileLock } from "@megasaver/shared/node";

export function recordContractRun(input: {
  storeRoot: string;
  projectId: string;
  at: string;
  results: readonly ContractResult[];
  deadlineMs?: number;
}): boolean {
  const dir = join(input.storeRoot, "contract-runs");
  const path = join(dir, `${input.projectId}.jsonl`);
  const lockPath = `${path}.lock`;
  const lines = input.results
    .map((r) =>
      JSON.stringify({
        at: input.at,
        name: r.name,
        pass: r.pass,
        failReasons: r.findings.filter((f) => f.status === "fail").map((f) => f.reason),
      }),
    )
    .join("\n");

  if (lines.length === 0) return true;

  const full = `${lines}\n`;
  let recorded = false;
  mkdirSync(dirname(lockPath), { recursive: true });
  const ran = withFileLock(
    lockPath,
    { deadlineMs: input.deadlineMs ?? 2000, staleMs: 30_000 },
    () => {
      appendFileSync(path, full, "utf8");
      recorded = true;
    },
  );
  if (!ran) return false;
  return recorded;
}
