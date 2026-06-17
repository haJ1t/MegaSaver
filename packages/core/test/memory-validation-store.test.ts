import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryEntryIdSchema, projectIdSchema } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import type { MemoryValidation } from "../src/memory-validation.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const ENTRY_ID = memoryEntryIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const TS = "2026-06-17T00:00:00.000Z";

function makeValidation(over: Partial<MemoryValidation> = {}): MemoryValidation {
  return {
    memoryEntryId: ENTRY_ID,
    validationStatus: "valid",
    reasons: [],
    conflictIds: [],
    validatedAt: TS,
    validatedBy: "system",
    policyVersion: "1",
    ...over,
  };
}

describe("MemoryValidation sidecar round-trip", () => {
  const roots: string[] = [];

  function makeRegistry() {
    const root = mkdtempSync(join(tmpdir(), "megasaver-core-valstore-"));
    mkdirSync(root, { recursive: true });
    roots.push(root);
    return createJsonDirectoryCoreRegistry({ rootDir: root });
  }

  afterEach(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
    roots.length = 0;
  });

  it("getMemoryValidation returns null before any write", () => {
    const registry = makeRegistry();
    expect(registry.getMemoryValidation(ENTRY_ID)).toBeNull();
  });

  it("setMemoryValidation persists and getMemoryValidation retrieves it", () => {
    const registry = makeRegistry();
    const v = makeValidation();
    registry.setMemoryValidation(v);
    const got = registry.getMemoryValidation(ENTRY_ID);
    expect(got).not.toBeNull();
    expect(got?.validationStatus).toBe("valid");
    expect(got?.memoryEntryId).toBe(ENTRY_ID);
  });

  it("setMemoryValidation overwrites an existing record (idempotent)", () => {
    const registry = makeRegistry();
    registry.setMemoryValidation(makeValidation({ validationStatus: "needs_approval" }));
    registry.setMemoryValidation(makeValidation({ validationStatus: "valid" }));
    expect(registry.getMemoryValidation(ENTRY_ID)?.validationStatus).toBe("valid");
  });

  it("setMemoryValidation with quarantined persists reasons + conflictIds", () => {
    const CONFLICT = memoryEntryIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const registry = makeRegistry();
    registry.setMemoryValidation(
      makeValidation({
        validationStatus: "quarantined",
        reasons: ["missing_evidence"],
        conflictIds: [CONFLICT],
      }),
    );
    const got = registry.getMemoryValidation(ENTRY_ID);
    expect(got?.reasons).toEqual(["missing_evidence"]);
    expect(got?.conflictIds).toEqual([CONFLICT]);
  });
});
