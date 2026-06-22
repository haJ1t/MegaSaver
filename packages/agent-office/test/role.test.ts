import { randomUUID } from "node:crypto";
import { roleIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type Role, roleSchema } from "../src/role.js";

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: roleIdSchema.parse(randomUUID()),
    name: "Architect",
    kind: "claude-code",
    persona: "You design systems and weigh trade-offs.",
    model: "opus",
    allowedTools: ["Read", "Grep"],
    skillPacks: [],
    permissionMode: "plan",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  } as Role;
}

describe("roleSchema", () => {
  it("accepts a valid role and an optional defaultWorkdir", () => {
    expect(roleSchema.parse(makeRole())).toMatchObject({
      name: "Architect",
      permissionMode: "plan",
    });
    const withDir = roleSchema.parse(makeRole({ defaultWorkdir: "/repo" }));
    expect(withDir.defaultWorkdir).toBe("/repo");
  });

  it("rejects an unknown permission mode", () => {
    expect(() =>
      roleSchema.parse(makeRole({ permissionMode: "yolo" as Role["permissionMode"] })),
    ).toThrow();
  });

  it("rejects an unknown model", () => {
    expect(() => roleSchema.parse(makeRole({ model: "gpt" as Role["model"] }))).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() => roleSchema.parse({ ...makeRole(), extra: 1 })).toThrow();
  });

  it("rejects a control-char name", () => {
    expect(() => roleSchema.parse(makeRole({ name: "bad\x07name" }))).toThrow();
  });

  it("rejects an empty persona", () => {
    expect(() => roleSchema.parse(makeRole({ persona: "" }))).toThrow();
  });

  it("rejects an allowedTools entry starting with '-' (CLI flag injection guard)", () => {
    expect(() => roleSchema.parse(makeRole({ allowedTools: ["--dangerously-skip"] }))).toThrow();
    expect(() => roleSchema.parse(makeRole({ allowedTools: ["-x"] }))).toThrow();
  });

  it("rejects an empty allowedTools entry", () => {
    expect(() => roleSchema.parse(makeRole({ allowedTools: [""] }))).toThrow();
  });
});
