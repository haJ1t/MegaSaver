import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConventionsError } from "../src/errors.ts";
import { resolveSource } from "../src/source.ts";

describe("resolveSource", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mega-conventions-src-"));
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns full file content with leading H1 stripped", async () => {
    await writeFile(join(dir, "a.md"), "# Title\n\nbody line\n");
    const out = await resolveSource({ conventionsDir: dir, source: "a.md", fragment: undefined });
    expect(out).toBe("body line");
  });

  it("returns content verbatim when no H1 is present", async () => {
    await writeFile(join(dir, "a.md"), "body line\nanother\n");
    const out = await resolveSource({ conventionsDir: dir, source: "a.md", fragment: undefined });
    expect(out).toBe("body line\nanother");
  });

  it("throws source-missing when the file is absent", async () => {
    try {
      await resolveSource({ conventionsDir: dir, source: "nope.md", fragment: undefined });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConventionsError);
      expect((err as ConventionsError).code).toBe("source-missing");
    }
  });

  it("extracts a heading fragment slice", async () => {
    await writeFile(
      join(dir, "r.md"),
      [
        "# Risk",
        "",
        "## LOW",
        "low body",
        "",
        "## HIGH",
        "high body",
        "",
        "## CRITICAL",
        "crit",
      ].join("\n"),
    );
    const out = await resolveSource({ conventionsDir: dir, source: "r.md", fragment: "HIGH" });
    expect(out).toBe("high body");
  });

  it("throws when the fragment heading is missing", async () => {
    await writeFile(join(dir, "r.md"), "# Risk\n\n## LOW\nbody\n");
    try {
      await resolveSource({ conventionsDir: dir, source: "r.md", fragment: "HIGH" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ConventionsError).code).toBe("source-fragment-missing");
    }
  });
});
