import type { CodeBlock } from "@megasaver/indexer";
import { codeBlockSchema } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { buildContextPack } from "../src/pack.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
let n = 0;
function block(over: Partial<CodeBlock> & { name: string; filePath: string }): CodeBlock {
  n += 1;
  return codeBlockSchema.parse({
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    projectId: PROJECT_ID,
    filePath: over.filePath,
    startLine: over.startLine ?? 1,
    endLine: over.endLine ?? 10,
    blockType: over.blockType ?? "function",
    name: over.name,
    contentHash: `h${n}`,
    imports: over.imports ?? [],
    exports: over.exports ?? [],
    calls: over.calls ?? [],
    calledBy: [],
    keywords: over.keywords ?? [],
  });
}

const blocks = [
  block({ name: "validateToken", filePath: "src/auth.ts", keywords: ["jwt", "auth"] }),
  block({ name: "Navbar", filePath: "src/nav.tsx", keywords: ["ui", "header"] }),
  block({ name: "hashPassword", filePath: "src/crypto.ts", keywords: ["hash", "bcrypt"] }),
];

describe("buildContextPack determinism guard", () => {
  it("returns identical included/excluded ordering across runs", () => {
    const a = buildContextPack({ task: "jwt auth", blocks });
    const b = buildContextPack({ task: "jwt auth", blocks });
    expect(a.included.map((x) => x.name)).toEqual(b.included.map((x) => x.name));
    expect(a.excluded.map((x) => x.name)).toEqual(b.excluded.map((x) => x.name));
  });

  it("keeps every excluded block recoverable (metadata present)", () => {
    const pack = buildContextPack({ task: "jwt auth", blocks, limit: 1 });
    for (const ex of pack.excluded) {
      expect(ex.filePath.length).toBeGreaterThan(0);
      expect((ex.name ?? "").length).toBeGreaterThan(0);
    }
  });
});
