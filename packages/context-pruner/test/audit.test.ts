import type { CodeBlock } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { auditPack } from "../src/audit.js";
import { type ContextPack, buildContextPack, contextPackSchema } from "../src/pack.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
let n = 0;

function block(over: Partial<CodeBlock> & { name: string; filePath: string }): CodeBlock {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    projectId: PROJECT_ID,
    filePath: over.filePath,
    startLine: over.startLine ?? 1,
    endLine: over.endLine ?? 10,
    blockType: over.blockType ?? "function",
    name: over.name,
    contentHash: `h${n}`,
    imports: [],
    exports: [],
    calls: over.calls ?? [],
    calledBy: [],
    keywords: over.keywords ?? [],
  };
}

function demoPack(): ContextPack {
  return buildContextPack({
    task: "fix validateToken auth",
    blocks: [
      block({ name: "validateToken", filePath: "src/auth.ts", keywords: ["auth", "jwt"] }),
      block({ name: "Navbar", filePath: "src/nav.tsx", keywords: ["ui"] }),
      block({ name: "lockfile", filePath: "pnpm-lock.yaml", blockType: "config" }),
    ],
    limit: 8,
  });
}

describe("buildContextPack", () => {
  it("produces a schema-valid pack with reasons on every block", () => {
    const pack = demoPack();
    expect(contextPackSchema.safeParse(pack).success).toBe(true);
    expect(pack.included.every((b) => b.reasons.length > 0)).toBe(true);
    const named = pack.included.find((b) => b.name === "validateToken");
    expect(named?.reasons).toContain("named in task");
  });
});

describe("auditPack", () => {
  it("reports file/block counts and token savings", () => {
    const audit = auditPack(demoPack());
    expect(audit.blocksConsidered).toBe(3);
    expect(audit.blocksIncluded + audit.blocksExcluded).toBe(3);
    expect(audit.tokensBefore).toBeGreaterThanOrEqual(audit.tokensAfter);
    expect(audit.percentSaved).toBeGreaterThanOrEqual(0);
  });
});
