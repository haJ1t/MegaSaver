import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPredefinedRoles, ensurePredefinedRoles } from "../src/predefined-roles.js";
import { listRoles, saveRole } from "../src/role-store.js";
import { roleSchema } from "../src/role.js";

const now = "2026-06-22T12:00:00.000Z";

describe("buildPredefinedRoles", () => {
  it("returns a non-empty set of schema-valid roles", () => {
    const roles = buildPredefinedRoles({ now, newId: () => randomUUID() });
    expect(roles.length).toBeGreaterThanOrEqual(8);
    for (const role of roles) {
      expect(() => roleSchema.parse(role)).not.toThrow();
    }
  });

  it("builds the full 24-role roster (one per agent-skill)", () => {
    expect(buildPredefinedRoles({ now, newId: () => randomUUID() })).toHaveLength(24);
  });

  it("gives every role exactly one non-empty skillPacks slug", () => {
    const roles = buildPredefinedRoles({ now, newId: () => randomUUID() });
    expect(
      roles.every((r) => r.skillPacks.length === 1 && (r.skillPacks[0] ?? "").length > 0),
    ).toBe(true);
  });

  it("makes every predefined role safe-by-default (permissionMode plan)", () => {
    const roles = buildPredefinedRoles({ now, newId: () => randomUUID() });
    expect(roles.every((r) => r.permissionMode === "plan")).toBe(true);
  });

  it("includes the agent-skills roster names", () => {
    const names = buildPredefinedRoles({ now, newId: () => randomUUID() }).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Spec Writer",
        "Planner",
        "Test-Driven Developer",
        "Code Reviewer",
        "Security Reviewer",
        "Debugger",
      ]),
    );
  });

  it("uses the injected id factory and now", () => {
    let i = 0;
    const roles = buildPredefinedRoles({
      now,
      newId: () => `00000000-0000-4000-8000-${String(i++).padStart(12, "0")}`,
    });
    expect(roles[0]?.createdAt).toBe(now);
    expect(roles[0]?.id).toBe("00000000-0000-4000-8000-000000000000");
    expect(roles.every((r) => r.createdAt === now)).toBe(true);
  });
});

describe("ensurePredefinedRoles", () => {
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "agent-office-seed-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("seeds the full roster into an empty store", async () => {
    const result = await ensurePredefinedRoles({
      storeRoot,
      now: () => now,
      newId: () => randomUUID(),
    });
    expect(result.seeded).toBe(24);
    expect((await listRoles({ storeRoot })).length).toBe(24);
  });

  it("is idempotent: a second call seeds nothing", async () => {
    await ensurePredefinedRoles({ storeRoot, now: () => now, newId: () => randomUUID() });
    const second = await ensurePredefinedRoles({
      storeRoot,
      now: () => now,
      newId: () => randomUUID(),
    });
    expect(second.seeded).toBe(0);
    expect((await listRoles({ storeRoot })).length).toBe(24);
  });

  it("does not seed when a role already exists (never clobbers user roles)", async () => {
    const role = buildPredefinedRoles({ now, newId: () => randomUUID() })[0];
    if (role) await saveRole({ storeRoot, role });
    const result = await ensurePredefinedRoles({
      storeRoot,
      now: () => now,
      newId: () => randomUUID(),
    });
    expect(result.seeded).toBe(0);
    expect((await listRoles({ storeRoot })).length).toBe(1);
  });
});
