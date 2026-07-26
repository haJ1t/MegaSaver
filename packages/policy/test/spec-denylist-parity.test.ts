import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DENYLIST_GLOBS } from "../src/secret-paths.js";

// The LOCKED §4a table is printed in the spec AND shipped in code, and the two
// drifted: #309 appended four globs to the code and left the spec at fifteen,
// recording the amendment only in a commit body. A locked table whose written
// form disagrees with its executed form is not locked, it is folklore.
//
// Reading a repo-root doc from a package test is established practice here —
// test/redos-probe-parity.test.ts already reaches into ../../../scripts/.
const SPEC = fileURLToPath(
  new URL("../../../docs/superpowers/specs/2026-05-10-bb3-policy-design.md", import.meta.url),
);

const section = (() => {
  const text = readFileSync(SPEC, "utf8");
  const start = text.indexOf("### §4a ");
  if (start === -1) throw new Error("§4a heading not found in the BB3 policy spec");
  const end = text.indexOf("### §4b", start);
  return text.slice(start, end === -1 ? undefined : end);
})();

describe("spec §4a is the same table the code ships", () => {
  it("the fenced glob block equals DENYLIST_GLOBS, in order", () => {
    const fence = /```\n([\s\S]*?)```/.exec(section);
    expect(fence, "§4a has no fenced glob block").not.toBeNull();
    const printed = (fence?.[1] ?? "").trim().split("\n");
    expect(printed).toEqual([...DENYLIST_GLOBS]);
  });

  it("the prose count line matches the array length", () => {
    const count = /^(\d+) patterns\./m.exec(section);
    expect(count, "§4a has no `<n> patterns.` line").not.toBeNull();
    expect(Number(count?.[1])).toBe(DENYLIST_GLOBS.length);
  });
});
