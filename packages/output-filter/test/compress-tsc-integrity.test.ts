import { describe, expect, it } from "vitest";
import { compressTsc } from "../src/compress/tsc.js";

// B6 against the A1 save-integrity contract: compressTsc must not delete
// content silently. Everything it removes is either kept verbatim elsewhere
// in the output (dedup) or named by an explicit, exactly-counted marker.

describe("compressTsc — position-less diagnostics survive (B6)", () => {
  it("keeps global/config errors that carry no file position", () => {
    const out = compressTsc(
      [
        "error TS5023: Unknown compiler option '--incremental'.",
        "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
        "Found 2 errors in 2 files.",
      ].join("\n"),
    );
    expect(out).toContain("error TS5023: Unknown compiler option '--incremental'.");
    expect(out).toContain("TS2304");
  });

  it("keeps multi-line elaborations and code frames attached to an error", () => {
    const out = compressTsc(
      [
        "src/a.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.",
        "",
        "10 const a: number = 'x';",
        "     ~~~~~~~~~~~~~~~~~~",
        "  The expected type comes from property 'a' which is declared here.",
        "src/b.ts(2,2): error TS2304: Cannot find name 'y'.",
      ].join("\n"),
    );
    expect(out).toContain("The expected type comes from property 'a'");
    expect(out).toContain("const a: number = 'x';");
    expect(out).toContain("TS2304");
  });
});

describe("compressTsc — omissions are explicit and exactly counted (B6)", () => {
  it("names removed non-diagnostic lines with a recovery marker, never silent", () => {
    const out = compressTsc(
      [
        "npm warn deprecated inflight@1.0.6",
        "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
        "webpack compiled with 3 warnings",
        "Found 1 error in 1 file.",
      ].join("\n"),
    );
    expect(out).not.toContain("npm warn deprecated");
    expect(out).not.toContain("webpack compiled");
    expect(out).toContain("… [2 non-diagnostic lines omitted — recoverable via stored chunks]");
  });

  it("marker count equals the exact number of dropped lines", () => {
    const noise = Array.from({ length: 7 }, (_, i) => `random top-level noise ${i}`);
    const input = [
      "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
      ...noise,
      "Found 1 error in 1 file.",
    ].join("\n");
    const out = compressTsc(input);
    expect(out).toContain("… [7 non-diagnostic lines omitted — recoverable via stored chunks]");
    for (const line of noise) expect(out).not.toContain(line);
  });

  it("emits no marker when nothing was dropped", () => {
    const out = compressTsc(
      ["src/a.ts(1,1): error TS2304: Cannot find name 'x'.", "Found 1 error in 1 file."].join("\n"),
    );
    expect(out).not.toContain("omitted");
  });
});

describe("compressTsc — header stays bounded (B6)", () => {
  it("caps the top-files header and names the remainder", () => {
    const lines: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      lines.push(`src/file${i}.ts(1,1): error TS2304: Cannot find name 'x${i}'.`);
    }
    const out = compressTsc(lines.join("\n"));
    expect(out).toContain("… and 4 more files");
    // every error line itself is still present — only the header is capped
    expect(out).toContain("src/file13.ts(1,1): error TS2304");
  });
});
