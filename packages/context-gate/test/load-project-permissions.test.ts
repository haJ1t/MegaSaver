import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyLoadError } from "@megasaver/policy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectPermissions } from "../src/load-project-permissions.js";

const PERMS_REL = join(".megasaver", "permissions.yaml");

async function writePerms(projectRoot: string, body: string): Promise<void> {
  await mkdir(join(projectRoot, ".megasaver"), { recursive: true });
  await writeFile(join(projectRoot, PERMS_REL), body, "utf8");
}

describe("loadProjectPermissions (permissions-yaml §4.1, §7 1b)", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "ctxgate-perms-"));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("absent file ⇒ null (absence is not a denial, I3)", () => {
    expect(loadProjectPermissions(projectRoot)).toBeNull();
  });

  it("valid file ⇒ compiled ProjectPermissions", async () => {
    await writePerms(
      projectRoot,
      ["deny:", '  read: ["creds/**"]', '  commands: ["make"]'].join("\n"),
    );
    const perms = loadProjectPermissions(projectRoot);
    expect(perms).not.toBeNull();
    expect(perms?.denyCommands).toEqual(["make"]);
    expect(perms?.denyReadPatterns).toHaveLength(1);
    expect(perms?.denyReadPatterns[0]?.test("creds/secret.txt")).toBe(true);
  });

  it("an empty file ⇒ empty permissions (yaml.parse('') is undefined ⇒ schema default)", async () => {
    await writePerms(projectRoot, "");
    const perms = loadProjectPermissions(projectRoot);
    expect(perms).not.toBeNull();
    expect(perms?.denyCommands).toEqual([]);
    expect(perms?.denyReadPatterns).toEqual([]);
    expect(perms?.denyWritePatterns).toEqual([]);
  });

  it("malformed YAML ⇒ PolicyLoadError (fail-closed, I3)", async () => {
    // Unclosed flow sequence is a YAML syntax error.
    await writePerms(projectRoot, "deny:\n  commands: [oops");
    expect(() => loadProjectPermissions(projectRoot)).toThrow(PolicyLoadError);
  });

  it("unknown key ⇒ PolicyLoadError (delegates to the .strict() parser, I1/I3)", async () => {
    await writePerms(projectRoot, ["allow:", '  commands: ["rm"]'].join("\n"));
    expect(() => loadProjectPermissions(projectRoot)).toThrow(PolicyLoadError);
  });

  it("a present-but-unreadable path (dir where the file is expected) ⇒ PolicyLoadError, not null", async () => {
    // .megasaver/permissions.yaml exists as a DIRECTORY → read fails with
    // EISDIR (a non-ENOENT fs error) → must fail-closed, never silently null.
    await mkdir(join(projectRoot, ".megasaver", "permissions.yaml"), { recursive: true });
    expect(() => loadProjectPermissions(projectRoot)).toThrow(PolicyLoadError);
  });
});
