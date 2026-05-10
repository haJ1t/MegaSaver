import { describe, expect, it } from "vitest";
import { skillPackManifestSchema } from "../src/manifest.js";

describe("skillPackManifestSchema", () => {
  it("accepts a minimal valid manifest", () => {
    const parsed = skillPackManifestSchema.parse({
      name: "example-pack",
      version: "0.1.0",
      kind: "skill",
      skills: [{ id: "do-thing", entry: "skills/do-thing.md" }],
      capabilities: ["read-memory"],
      description: null,
    });
    expect(parsed.name).toBe("example-pack");
    expect(parsed.kind).toBe("skill");
  });

  it("rejects an empty object", () => {
    const result = skillPackManifestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a non-kebab pack name", () => {
    const result = skillPackManifestSchema.safeParse({
      name: "Example Pack",
      version: "0.1.0",
      kind: "skill",
      skills: [],
      capabilities: [],
      description: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-semver version", () => {
    const result = skillPackManifestSchema.safeParse({
      name: "example-pack",
      version: "latest",
      kind: "skill",
      skills: [],
      capabilities: [],
      description: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown capability", () => {
    const result = skillPackManifestSchema.safeParse({
      name: "example-pack",
      version: "0.1.0",
      kind: "skill",
      skills: [],
      capabilities: ["filesystem"],
      description: null,
    });
    expect(result.success).toBe(false);
  });
});
