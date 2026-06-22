import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runOfficeRoleCreate,
  runOfficeRoleList,
  runOfficeRoleRm,
  runOfficeRoleSeed,
} from "../../../src/commands/office/role.js";

// Fixed UUIDs for deterministic test output
const ROLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = "2026-06-22T12:00:00.000Z";

function makeInput(tmpDir: string, overrides: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const errs: string[] = [];
  return {
    storeFlag: tmpDir,
    cwd: tmpDir,
    home: tmpDir,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (line: string) => lines.push(line),
    stderr: (line: string) => errs.push(line),
    newId: () => ROLE_ID,
    now: () => NOW,
    lines,
    errs,
    ...overrides,
  };
}

describe("runOfficeRoleCreate", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-role-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("happy path — creates role, prints id", async () => {
    const inp = makeInput(tmpDir);
    const code = await runOfficeRoleCreate({
      ...inp,
      nameFlag: "Coder",
      personaFlag: "You are a senior engineer.",
      modelFlag: "sonnet",
      permissionModeFlag: "plan",
    });
    expect(code).toBe(0);
    expect(inp.lines[0]).toBe(ROLE_ID);
  });

  it("json flag — prints JSON with correct id", async () => {
    const inp = makeInput(tmpDir);
    const code = await runOfficeRoleCreate({
      ...inp,
      nameFlag: "Coder",
      personaFlag: "Persona.",
      modelFlag: "haiku",
      permissionModeFlag: "acceptEdits",
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(inp.lines[0] ?? "{}") as { id: string };
    expect(parsed.id).toBe(ROLE_ID);
  });

  it("rejects tool starting with '-'", async () => {
    const inp = makeInput(tmpDir);
    const code = await runOfficeRoleCreate({
      ...inp,
      nameFlag: "Bad",
      personaFlag: "Persona.",
      modelFlag: "sonnet",
      permissionModeFlag: "plan",
      toolsFlag: "Bash,-dangerousFlag",
    });
    expect(code).toBe(1);
    expect(inp.errs.join("")).toContain("tool must not start with");
    expect(inp.errs.join("")).toContain("-dangerousFlag");
  });

  it("rejects invalid model", async () => {
    const inp = makeInput(tmpDir);
    const code = await runOfficeRoleCreate({
      ...inp,
      nameFlag: "Bad",
      personaFlag: "Persona.",
      modelFlag: "gpt-4",
      permissionModeFlag: "plan",
    });
    expect(code).toBe(1);
    expect(inp.errs.join("")).toContain("invalid model");
  });

  it("rejects invalid permission-mode", async () => {
    const inp = makeInput(tmpDir);
    const code = await runOfficeRoleCreate({
      ...inp,
      nameFlag: "Bad",
      personaFlag: "Persona.",
      modelFlag: "sonnet",
      permissionModeFlag: "sudo",
    });
    expect(code).toBe(1);
    expect(inp.errs.join("")).toContain("invalid permission-mode");
  });
});

describe("runOfficeRoleList", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-role-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("empty list returns 0", async () => {
    const inp = makeInput(tmpDir);
    const code = await runOfficeRoleList({ ...inp });
    expect(code).toBe(0);
    expect(inp.lines).toHaveLength(0);
  });

  it("lists created role", async () => {
    const inp = makeInput(tmpDir);
    await runOfficeRoleCreate({
      ...inp,
      nameFlag: "Coder",
      personaFlag: "Persona.",
      modelFlag: "sonnet",
      permissionModeFlag: "plan",
    });
    inp.lines.length = 0;

    const code = await runOfficeRoleList({ ...inp });
    expect(code).toBe(0);
    expect(inp.lines[0]).toContain("Coder");
    expect(inp.lines[0]).toContain(ROLE_ID);
  });
});

describe("runOfficeRoleRm", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-role-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes existing role, returns 0", async () => {
    const createInp = makeInput(tmpDir);
    await runOfficeRoleCreate({
      ...createInp,
      nameFlag: "Coder",
      personaFlag: "Persona.",
      modelFlag: "sonnet",
      permissionModeFlag: "plan",
    });

    const inp = makeInput(tmpDir);
    const code = await runOfficeRoleRm({ ...inp, roleId: ROLE_ID });
    expect(code).toBe(0);
    // After rm, list returns empty
    inp.lines.length = 0;
    const listCode = await runOfficeRoleList({ ...inp });
    expect(listCode).toBe(0);
    expect(inp.lines).toHaveLength(0);
  });

  it("returns 0 for non-existent role (force:true, silent)", async () => {
    const inp = makeInput(tmpDir);
    const code = await runOfficeRoleRm({
      ...inp,
      roleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(code).toBe(0);
  });
});

describe("runOfficeRoleSeed", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-role-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedNewId(): () => string {
    let i = 0;
    return () => `00000000-0000-4000-8000-${String(i++).padStart(12, "0")}`;
  }

  it("seeds the predefined roster, then list shows 24", async () => {
    const inp = makeInput(tmpDir, { newId: seedNewId() });
    const code = await runOfficeRoleSeed({ ...inp });
    expect(code).toBe(0);
    expect(inp.lines.join("\n")).toContain("seeded 24");

    const listInp = makeInput(tmpDir);
    await runOfficeRoleList({ ...listInp, json: true });
    expect(JSON.parse(listInp.lines[0] ?? "[]")).toHaveLength(24);
  });

  it("is idempotent: a second seed reports nothing seeded", async () => {
    await runOfficeRoleSeed({ ...makeInput(tmpDir, { newId: seedNewId() }) });
    const inp = makeInput(tmpDir, { newId: seedNewId() });
    const code = await runOfficeRoleSeed({ ...inp });
    expect(code).toBe(0);
    expect(inp.lines.join("\n")).toContain("nothing seeded");
  });
});
