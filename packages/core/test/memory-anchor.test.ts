import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  codeAnchorSchema,
  fileAnchorSchema,
  lastVerifiedSchema,
  symbolAnchorSchema,
  verificationResultSchema,
} from "../src/memory-anchor.js";
import {
  type MemoryEntry,
  memoryEntrySchema,
  memoryEntryUpdatePatchSchema,
  overlayMemoryEntrySchema,
} from "../src/memory-entry.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const ENTRY_ID = "00000000-0000-4000-8000-0000000000a1" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-13T12:00:00.000Z";

const ANCHOR = {
  repoHead: "3f786850e387550fdab836ed7e6dc881de23001b",
  capturedAt: TS,
  files: [{ path: "src/a.ts", blobSha: "89e6c98d92887913cadf06b2adb97f26cde4849b" }],
  symbols: [
    {
      path: "src/a.ts",
      name: "alpha",
      startLine: 1,
      endLine: 3,
      contentHash: "2b66fd261ee5c6cfc8de7fa466bab600bcfe4f69",
    },
  ],
};

const LAST_VERIFIED = {
  headSha: "3f786850e387550fdab836ed7e6dc881de23001b",
  at: NOW,
  result: "verified" as const,
  closedByCodeTruth: false,
};

function baseEntry(): Record<string, unknown> {
  return {
    id: ENTRY_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "auth uses jwt",
    content: "auth uses jwt",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  };
}

describe("memory-anchor schemas", () => {
  it("parses file, symbol, and code anchors", () => {
    expect(fileAnchorSchema.parse(ANCHOR.files[0])).toEqual(ANCHOR.files[0]);
    expect(symbolAnchorSchema.parse(ANCHOR.symbols[0])).toEqual(ANCHOR.symbols[0]);
    expect(codeAnchorSchema.parse(ANCHOR)).toEqual(ANCHOR);
  });

  it("rejects unknown keys on every anchor shape (strict)", () => {
    expect(fileAnchorSchema.safeParse({ ...ANCHOR.files[0], bogus: 1 }).success).toBe(false);
    expect(symbolAnchorSchema.safeParse({ ...ANCHOR.symbols[0], bogus: 1 }).success).toBe(false);
    expect(codeAnchorSchema.safeParse({ ...ANCHOR, bogus: 1 }).success).toBe(false);
  });

  it("rejects control chars in anchor paths but allows spaces (cat-file stdin guard)", () => {
    // A newline would inject an extra `HEAD:<path>` query into the batched
    // cat-file stdin and shift every positional lines[i] -> paths[i] pairing.
    const newlinePath = "src/a.ts\nHEAD:src/secret.ts";
    const delPath = "src/a\x7fb.ts";
    const spacePath = "docs/Design Doc.md";
    expect(fileAnchorSchema.safeParse({ ...ANCHOR.files[0], path: newlinePath }).success).toBe(
      false,
    );
    expect(fileAnchorSchema.safeParse({ ...ANCHOR.files[0], path: delPath }).success).toBe(false);
    expect(symbolAnchorSchema.safeParse({ ...ANCHOR.symbols[0], path: newlinePath }).success).toBe(
      false,
    );
    expect(
      codeAnchorSchema.safeParse({
        ...ANCHOR,
        files: [{ ...ANCHOR.files[0], path: newlinePath }],
      }).success,
    ).toBe(false);
    // Space is NOT an injection vector — cat-file resolves `HEAD:docs/Design
    // Doc.md` as one object — and must parse so legit paths aren't dropped.
    expect(fileAnchorSchema.safeParse({ ...ANCHOR.files[0], path: spacePath }).success).toBe(true);
    // A normal repo-relative path with dots/slashes/hyphens still parses.
    expect(fileAnchorSchema.safeParse({ path: "src/my-file_2.ts", blobSha: "x" }).success).toBe(
      true,
    );
  });

  it("rejects non-positive line numbers on symbol anchors", () => {
    expect(symbolAnchorSchema.safeParse({ ...ANCHOR.symbols[0], startLine: 0 }).success).toBe(
      false,
    );
  });

  it("verificationResultSchema admits exactly verified|contradicted|healed", () => {
    expect(verificationResultSchema.parse("verified")).toBe("verified");
    expect(verificationResultSchema.parse("contradicted")).toBe("contradicted");
    expect(verificationResultSchema.parse("healed")).toBe("healed");
    expect(verificationResultSchema.safeParse("stale").success).toBe(false);
  });

  it("lastVerifiedSchema requires closedByCodeTruth and rejects unknown keys", () => {
    expect(lastVerifiedSchema.parse(LAST_VERIFIED)).toEqual(LAST_VERIFIED);
    const { closedByCodeTruth: _drop, ...missing } = LAST_VERIFIED;
    expect(lastVerifiedSchema.safeParse(missing).success).toBe(false);
    expect(lastVerifiedSchema.safeParse({ ...LAST_VERIFIED, bogus: 1 }).success).toBe(false);
  });
});

describe("memory entry anchor fields", () => {
  it("memoryEntrySchema round-trips anchor + lastVerified", () => {
    const entry = memoryEntrySchema.parse({
      ...baseEntry(),
      anchor: ANCHOR,
      lastVerified: LAST_VERIFIED,
    });
    expect(entry.anchor).toEqual(ANCHOR);
    expect(entry.lastVerified).toEqual(LAST_VERIFIED);
  });

  it("legacy row without anchor fields still parses (additive)", () => {
    const entry = memoryEntrySchema.parse(baseEntry());
    expect(entry.anchor).toBeUndefined();
    expect(entry.lastVerified).toBeUndefined();
  });

  it("memoryEntrySchema still rejects unknown keys (strict regression)", () => {
    expect(memoryEntrySchema.safeParse({ ...baseEntry(), bogus: 1 }).success).toBe(false);
  });

  it("overlayMemoryEntrySchema accepts anchor + lastVerified and stays strict", () => {
    const overlay: Record<string, unknown> = {
      ...baseEntry(),
      workspaceKey: "ws-1",
      liveSessionId: null,
      anchor: ANCHOR,
      lastVerified: LAST_VERIFIED,
    };
    const { projectId: _p, sessionId: _s, ...overlayRow } = overlay;
    const parsed = overlayMemoryEntrySchema.parse(overlayRow);
    expect(parsed.anchor).toEqual(ANCHOR);
    expect(parsed.lastVerified).toEqual(LAST_VERIFIED);
    expect(overlayMemoryEntrySchema.safeParse({ ...overlayRow, bogus: 1 }).success).toBe(false);
  });

  it("update patch accepts anchor + lastVerified and still rejects unknown keys", () => {
    const patch = memoryEntryUpdatePatchSchema.parse({
      anchor: ANCHOR,
      lastVerified: LAST_VERIFIED,
      updatedAt: NOW,
    });
    expect(patch.anchor).toEqual(ANCHOR);
    expect(patch.lastVerified).toEqual(LAST_VERIFIED);
    expect(memoryEntryUpdatePatchSchema.safeParse({ updatedAt: NOW, bogus: 1 }).success).toBe(
      false,
    );
  });

  it("registry updateMemoryEntry persists an anchor patch (full-entry re-parse)", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
    registry.createMemoryEntry(memoryEntrySchema.parse(baseEntry()) as MemoryEntry);
    registry.updateMemoryEntry(ENTRY_ID, {
      anchor: ANCHOR,
      lastVerified: LAST_VERIFIED,
      updatedAt: NOW,
    });
    const stored = registry.getMemoryEntry(ENTRY_ID);
    expect(stored?.anchor).toEqual(ANCHOR);
    expect(stored?.lastVerified).toEqual(LAST_VERIFIED);
  });
});
