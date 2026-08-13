import { describe, expect, it } from "vitest";
import { compressCargoBuild } from "../../src/filters/cargo-build.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "cargo-build");
if (filter === undefined) throw new Error("cargo-build not registered");

const WARN_BLOCK = [
  "warning: unused variable: `retries`",
  " --> src/net/client.rs:41:9",
  "  |",
  "41 |     let retries = 3;",
  "  |         ^^^^^^^ help: if this is intentional, prefix it with an underscore: `_retries`",
  "  |",
  "  = note: `#[warn(unused_variables)]` on by default",
];
const CARGO = [
  ...Array.from({ length: 30 }, (_, i) => `   Compiling crate-${i} v0.${i}.0`),
  "   Compiling megasaver-net v0.4.2 (/repo/net)",
  ...WARN_BLOCK,
  "",
  "warning: `megasaver-net` (lib) generated 1 warning",
  "",
  ...WARN_BLOCK,
  "",
  'warning: `megasaver-net` (bin "mega-net") generated 1 warning',
  "",
  "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 42.17s",
].join("\n");

describe("cargo-build filter", () => {
  it("caps the crate run and folds exact-duplicate warning blocks", () => {
    const out = assertFilterConformance(filter, CARGO);
    expect(out).toContain("   Compiling crate-2 v0.2.0");
    expect(out).not.toContain("   Compiling crate-3 v0.3.0");
    expect(out).toContain("… [28 crates compiled]");
    expect(out).toContain("warning: unused variable: `retries`");
    expect(out).toContain('warning: `megasaver-net` (bin "mega-net") generated 1 warning');
    expect(out).toContain("… [1 duplicate warnings]");
    expect(out).toContain("Finished `dev` profile");
    expect(out.split("warning: unused variable: `retries`").length).toBe(2);
  });
});
