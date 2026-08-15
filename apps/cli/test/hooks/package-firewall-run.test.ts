import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAllowlistEntry, firewallEventSchema, firewallLogPath } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPackageFirewallText } from "../../src/hooks/package-firewall-run.js";

const roots: string[] = [];
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-pkg-firewall-"));
  roots.push(root);
});
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function editPayload(newString: string, overrides: Record<string, unknown> = {}) {
  return {
    session_id: "s-1234",
    cwd: root,
    tool_name: "Edit",
    tool_input: {
      file_path: join(root, "src", "app.ts"),
      old_string: "// TODO",
      new_string: newString,
      ...overrides,
    },
  };
}

function ledgerLines(): { kind: string; packageName?: string; suggestion?: string }[] {
  try {
    const raw = readFileSync(firewallLogPath(root), "utf8");
    return raw
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => {
        const parsed = firewallEventSchema.safeParse(JSON.parse(l));
        return parsed.success
          ? (parsed.data as { kind: string; packageName?: string; suggestion?: string })
          : { kind: "invalid" };
      });
  } catch {
    return [];
  }
}

describe("buildPackageFirewallText", () => {
  it("unknown npm ref → warn text with typosquat hint + CLI pointers; ledger holds both events", async () => {
    const text = await buildPackageFirewallText({
      payload: editPayload('import { pad } from "left-padd";'),
      storeRoot: root,
      now: () => 1_700_000_000_000,
    });
    expect(text).toContain("left-padd");
    expect(text).toContain('Did you mean "left-pad"?');
    expect(text).toContain("mega firewall refresh left-padd");
    expect(text).toContain("mega firewall allow left-padd --ecosystem npm");
    const lines = ledgerLines();
    expect(lines.map((l) => l.kind)).toContain("unknown-package");
    expect(lines.map((l) => l.kind)).toContain("typosquat-suspect");
    expect(lines.find((l) => l.kind === "typosquat-suspect")?.suggestion).toBe("left-pad");
  });

  it("same session + same name again → silent (warned-set dedupe); a different session warns again", async () => {
    const input = {
      payload: editPayload('import x from "left-padd";'),
      storeRoot: root,
      now: () => 1_700_000_000_000,
    };
    expect(await buildPackageFirewallText(input)).not.toBe("");
    expect(await buildPackageFirewallText(input)).toBe("");
    const otherSession = editPayload('import x from "left-padd";');
    otherSession.session_id = "s-9999";
    expect(await buildPackageFirewallText({ ...input, payload: otherSession })).not.toBe("");
  });

  it("allowlisted name → silent", async () => {
    appendAllowlistEntry(root, { name: "left-padd", ecosystem: "npm", addedAt: "t" });
    const text = await buildPackageFirewallText({
      payload: editPayload('import x from "left-padd";'),
      storeRoot: root,
      now: () => 1_700_000_000_000,
    });
    expect(text).toBe("");
  });

  it("tier-1 node_modules presence → silent", async () => {
    mkdirSync(join(root, "node_modules", "left-padd"), { recursive: true });
    const text = await buildPackageFirewallText({
      payload: editPayload('import x from "left-padd";'),
      storeRoot: root,
      now: () => 1_700_000_000_000,
    });
    expect(text).toBe("");
  });

  it("known seed name → silent", async () => {
    const text = await buildPackageFirewallText({
      payload: editPayload('import React from "react";'),
      storeRoot: root,
      now: () => 1_700_000_000_000,
    });
    expect(text).toBe("");
  });

  it("new-text-only: old_string imports never fire", async () => {
    const text = await buildPackageFirewallText({
      payload: editPayload("plain prose", {
        old_string: 'import x from "left-padd";',
      }),
      storeRoot: root,
      now: () => 1_700_000_000_000,
    });
    expect(text).toBe("");
  });

  it("Write tool with content and a requirements.txt path → pypi warn with hint", async () => {
    const payload = editPayload("reqeusts==2.0", { file_path: join(root, "requirements.txt") });
    payload["tool_name"] = "Write";
    const toolInput = payload["tool_input"] as Record<string, unknown>;
    delete toolInput["new_string"];
    toolInput["content"] = "reqeusts==2.0";
    const text = await buildPackageFirewallText({
      payload,
      storeRoot: root,
      now: () => 1_700_000_000_000,
    });
    expect(text).toContain("reqeusts");
    expect(text).toContain('Did you mean "requests"?');
  });

  it("malformed payload / non-edit tool / missing file_path / .ipynb → silent", async () => {
    const base = { storeRoot: root, now: () => 1_700_000_000_000 };
    expect(await buildPackageFirewallText({ ...base, payload: "not an object" })).toBe("");
    expect(
      await buildPackageFirewallText({
        ...base,
        payload: { session_id: "s", cwd: root, tool_name: "Bash", tool_input: {} },
      }),
    ).toBe("");
    expect(
      await buildPackageFirewallText({
        ...base,
        payload: { session_id: "s", cwd: root, tool_name: "Edit", tool_input: { new_string: 'import x from "left-padd";' } },
      }),
    ).toBe("");
    expect(
      await buildPackageFirewallText({
        ...base,
        payload: editPayload('import x from "left-padd";', { file_path: join(root, "nb.ipynb") }),
      }),
    ).toBe("");
  });

  it("never-throws: storeRoot pointing at a FILE still resolves to a string", async () => {
    const filePath = join(root, "a-file");
    writeFileSync(filePath, "x");
    await expect(
      buildPackageFirewallText({
        payload: editPayload('import x from "left-padd";'),
        storeRoot: filePath,
        now: () => 1_700_000_000_000,
      }),
    ).resolves.toBeTypeOf("string");
  });
});
