import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputPipeline } from "../src/run.js";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333" as ProjectId;
const SESSION_ID = "44444444-4444-4444-8444-444444444444" as SessionId;
const NOW = "2026-06-29T09:00:00.000Z";

// A multi-declaration TS file with real bodies, so outlineFile produces
// blocks AND the signature skeleton is meaningfully smaller than raw (the
// outline size floor only takes the branch when it actually saves context).
const TS_FIXTURE = `import { readFile } from "node:fs/promises";

export function alpha(x: number): number {
  const doubled = x * 2;
  const plus = doubled + 1;
  return plus;
}

export function beta(s: string): string {
  const trimmed = s.trim();
  const upper = trimmed.toUpperCase();
  return upper;
}

export async function gamma(path: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  const trimmed = raw.trim();
  return trimmed;
}

export function delta(values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum;
}
`;

function registry(projectRoot: string): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: {
              mode: "balanced",
              maxReturnedBytes: 12_000,
              storeRawOutput: true,
            },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (f) => f,
    listSessionFailures: () => [],
  };
}

describe("runOutputPipeline — outline flag", () => {
  let store: string;
  let projectRoot: string;
  let filePath: string;
  let idCounter: number;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-outline-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-outline-root-"));
    filePath = join(projectRoot, "sample.ts");
    await writeFile(filePath, TS_FIXTURE);
    idCounter = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function run(opts: { outline?: boolean } = {}) {
    return runOutputPipeline({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: filePath,
      intent: "map the file",
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      ...(opts.outline === true ? { outline: true } : {}),
    });
  }

  it("returns an outline decision when outline:true is passed", async () => {
    const out = await run({ outline: true });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.decision).toBe("outline");
    expect(out.result.chunkSetId).toBeDefined();
  });

  it("does not cross-suppress a full read and an outline read of the same file", async () => {
    const full = await run();
    expect(full.ok).toBe(true);

    const outline = await run({ outline: true });
    expect(outline.ok).toBe(true);
    if (!outline.ok) return;
    // The outline read must NOT return unchanged-marker — they are keyed separately.
    expect(outline.result.decision).toBe("outline");
  });
});
