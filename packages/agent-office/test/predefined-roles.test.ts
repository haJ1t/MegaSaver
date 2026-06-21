import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPredefinedRoles } from "../src/predefined-roles.js";
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

  it("builds the full 13-role roster", () => {
    expect(buildPredefinedRoles({ now, newId: () => randomUUID() })).toHaveLength(13);
  });

  it("makes every predefined role safe-by-default (permissionMode plan)", () => {
    const roles = buildPredefinedRoles({ now, newId: () => randomUUID() });
    expect(roles.every((r) => r.permissionMode === "plan")).toBe(true);
  });

  it("includes the core roster names", () => {
    const names = buildPredefinedRoles({ now, newId: () => randomUUID() }).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Architect",
        "Executor",
        "Code Reviewer",
        "Critic",
        "Debugger",
        "Verifier",
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
