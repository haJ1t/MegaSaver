import { describe, expect, it } from "vitest";
import {
  agentCreateInputSchema,
  allowedToolSchema,
  controlInputSchema,
  roleCreateInputSchema,
  taskCreateInputSchema,
} from "../../../bridge/office-validation.js";

describe("allowedToolSchema", () => {
  it("accepts a normal tool name", () => {
    expect(allowedToolSchema.safeParse("Bash").success).toBe(true);
  });

  it("rejects empty string", () => {
    expect(allowedToolSchema.safeParse("").success).toBe(false);
  });

  it("rejects leading dash (security: prevents CLI flag injection)", () => {
    expect(allowedToolSchema.safeParse("-add-dir").success).toBe(false);
    expect(allowedToolSchema.safeParse("--add-dir").success).toBe(false);
  });
});

describe("roleCreateInputSchema", () => {
  const valid = {
    name: "Test Role",
    kind: "claude-code",
    persona: "You are a test agent.",
    model: "sonnet",
    allowedTools: ["Bash", "Read"],
    skillPacks: [],
    permissionMode: "plan",
  } as const;

  it("accepts valid role input", () => {
    expect(roleCreateInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects allowedTools with leading dash", () => {
    const r = roleCreateInputSchema.safeParse({ ...valid, allowedTools: ["--evil-flag"] });
    expect(r.success).toBe(false);
  });

  it("rejects extra fields (.strict())", () => {
    const r = roleCreateInputSchema.safeParse({ ...valid, id: "injected-id" });
    expect(r.success).toBe(false);
  });

  it("requires persona", () => {
    const r = roleCreateInputSchema.safeParse({ ...valid, persona: "" });
    expect(r.success).toBe(false);
  });
});

describe("agentCreateInputSchema", () => {
  it("accepts valid agent input", () => {
    const r = agentCreateInputSchema.safeParse({
      name: "My Agent",
      roleId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      workdir: "/tmp/workspace",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty workdir", () => {
    const r = agentCreateInputSchema.safeParse({
      name: "My Agent",
      roleId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      workdir: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("taskCreateInputSchema", () => {
  it("accepts valid task input", () => {
    expect(taskCreateInputSchema.safeParse({ instruction: "Do the thing." }).success).toBe(true);
  });

  it("rejects empty instruction", () => {
    expect(taskCreateInputSchema.safeParse({ instruction: "" }).success).toBe(false);
  });
});

describe("controlInputSchema", () => {
  it("accepts valid actions", () => {
    for (const action of ["pause", "resume", "stop"] as const) {
      expect(controlInputSchema.safeParse({ action }).success).toBe(true);
    }
  });

  it("rejects unknown action", () => {
    expect(controlInputSchema.safeParse({ action: "delete" }).success).toBe(false);
  });
});
