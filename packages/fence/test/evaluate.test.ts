import { describe, expect, it } from "vitest";
import {
  compileFence,
  evaluateFenceWrite,
  normalizeFencePath,
} from "../src/evaluate.js";
import { parseFenceFile } from "../src/fence-file.js";
import { formatFenceDenyReason, formatFenceWarn } from "../src/texts.js";

const FILE = parseFenceFile({
  version: 1,
  allow: ["dist/keep.txt"],
  entries: [
    {
      path: "dist/**",
      class: "build-output",
      reason: "derived: build-output dir on disk",
      mode: "deny",
    },
    {
      path: "pnpm-lock.yaml",
      class: "lockfile",
      reason: "derived: lockfile basename",
    },
  ],
});
const compiled = compileFence(FILE);
const verdictOf = (relPath: string) => evaluateFenceWrite({ compiled, relPath });

describe("evaluateFenceWrite", () => {
  it("allow globs win over entries (allowed, silent)", () => {
    expect(verdictOf("dist/keep.txt")).toEqual({ verdict: "allowed" });
  });
  it("first matching entry decides; mode defaults to warn", () => {
    const deny = verdictOf("dist/bundle.js");
    expect(deny.verdict).toBe("deny");
    const warn = verdictOf("pnpm-lock.yaml");
    expect(warn.verdict).toBe("warn");
    expect(verdictOf("src/app.ts")).toEqual({ verdict: "allowed" });
  });
  it("win32 separators and case cannot bypass an entry (structural, no node:path)", () => {
    expect(normalizeFencePath("DIST\\Bundle.JS")).toBe("dist/bundle.js");
    expect(
      evaluateFenceWrite({
        compiled,
        relPath: normalizeFencePath("DIST\\Bundle.JS"),
      }).verdict,
    ).toBe("deny");
  });
});

describe("texts", () => {
  it("warn names class, alternative, and the override one-liner", () => {
    const v = verdictOf("pnpm-lock.yaml");
    if (v.verdict === "allowed") throw new Error("expected warn");
    const text = formatFenceWarn(v.entry, "pnpm-lock.yaml");
    expect(text).toContain("Generated-File Fence");
    expect(text).toContain("lockfile");
    expect(text).toContain("pnpm install");
    expect(text).toContain("mega fence allow pnpm-lock.yaml");
  });
  it("deny reason carries the same guidance", () => {
    const v = verdictOf("dist/bundle.js");
    if (v.verdict === "allowed") throw new Error("expected deny");
    expect(formatFenceDenyReason(v.entry, "dist/bundle.js")).toContain(
      "mega fence allow dist/bundle.js",
    );
  });
});
