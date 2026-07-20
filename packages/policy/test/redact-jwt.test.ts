import { describe, expect, it } from "vitest";
import { redactWithFindings } from "../src/redact.js";
import { REDACTION_PATTERNS } from "../src/redaction-patterns.js";

const jwtEntry = REDACTION_PATTERNS.find((entry) => entry.name === "jwt");
if (jwtEntry === undefined) throw new Error("jwt detector missing from REDACTION_PATTERNS");

const apply = (input: string): string => input.replace(jwtEntry.pattern, jwtEntry.replacement);

describe("jwt detector — structural gate (fix spec §6.1)", () => {
  // Both branches, not just the first: pinning only "(?<![A-Za-z0-9_-])" would
  // accept the pre-amendment pattern that drops every percent-escaped carrier.
  // This still rejects the narrowed "(?<![A-Za-z0-9])" edit §5 warns about.
  it("is left-boundary gated by the two-branch lookbehind alternation", () => {
    expect(
      jwtEntry.pattern.source.startsWith("(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))"),
    ).toBe(true);
  });

  // redact() derives its count from a global replace, so dropping /g silently
  // under-reports every finding and leaves every JWT after the first in
  // cleartext. Nothing else in the repo asserts .flags on any pattern.
  it("is global", () => {
    expect(jwtEntry.pattern.flags).toBe("g");
  });
});

// Wall clock is kept ONLY at 313 KiB: 8,374 ms broken vs 0.45 ms fixed is four
// orders of magnitude, wide enough to survive a Windows runner's GC or AV pause.
// The 39 KiB rung was dropped: a 50 ms ceiling there sits only ~2.3x under the
// broken 113 ms (though ~800x over the 0.06 ms pass value) — too thin, a GC
// pause flips it.
const CEILING_MS = 500;
const SCALE_KIB = 313;

// Four seeds, not one. Narrowing the lookbehind to (?<![A-Za-z0-9]) — the exact
// edit that would undo the §5 trade-off — leaves 'eyJaA0' at 0.46 ms while
// '-eyJaA' costs 7,728 ms and '_eyJaA' costs 7,416 ms. Without those two the
// quadratic can return with CI green, so they must not be removed.
// '%3DeyJaA' does NOT discriminate that edit (0.3 ms either way); it guards the
// second lookbehind branch, whose one structural risk is a future edit that
// makes it scan. Measured 0.32 ms.
const SEEDS = ["eyJaA0", "-eyJaA", "_eyJaA", "%3DeyJaA"] as const;

describe("jwt detector — ReDoS timing regression (fix spec §6.2)", () => {
  for (const seed of SEEDS) {
    it(`stays under ${CEILING_MS} ms on ${SCALE_KIB} KiB of ${JSON.stringify(seed)}`, () => {
      const input = seed.repeat(Math.ceil((SCALE_KIB * 1024) / seed.length));
      const started = performance.now();
      apply(input);
      expect(performance.now() - started).toBeLessThan(CEILING_MS);
    });
  }
});

const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4";

// Every segment carries both `-` and `_`. The rest of the corpus holds only 47
// of the 64 base64url characters and no `-` or `_` in ANY segment, which makes
// narrowing a segment class to [A-Za-z0-9] invisible (fix spec §6.0).
const DASH_UNDERSCORE_JWT =
  "eyJhbGciOiJIUzI1NiJ9-_x.eyJzdWIiOiIxMjM0NTY3ODkwIn0-_y.SflKxw-RJSMeKKF_2QT4";

// alg:none — segment length bounds drop it, and an unsigned token is precisely
// the one an attacker forges.
const ALG_NONE_JWT = "eyJhbGciOiJub25lIn0.eyJhIjoxfQ.X";

// github_token is `gh[pousr]_[A-Za-z0-9]{36,}`, so the body must be a real
// 36-character installation-token body for it to fire at all. That is the case
// that matters: a shorter app id produces NO finding, which is obvious, while
// this one produces a finding and still leaks the whole JWT.
const GHS_GLUED = `ghs_16BvJC3Xdj0kFdmxSU0FzWkBnb8xk4h9ykSb_${SAMPLE_JWT}`;

// These six are the ACCEPTED loss from the corrected fix spec §5, not a gap. A
// JWT preceded directly by a RAW base64url character no longer redacts — raw,
// because a percent-escape ends in a hex digit that is itself in the class and
// IS recovered by the second lookbehind branch (see the percent carriers below).
// Do not "fix" these by narrowing the lookbehind to (?<![A-Za-z0-9]): that
// restores the first two and restores the quadratic with them (7,728 ms and
// 7,416 ms at 313 KiB). The hybrid alternation that recovers them was measured
// at 125x the simple fix and rejected in the same section — unlike `%`, which is
// outside the run class and therefore nearly free.
describe("jwt detector — accepted §5 trade-off, do not narrow the lookbehind", () => {
  const glued: ReadonlyArray<readonly [string, string]> = [
    ["a session- prefix", `session-${SAMPLE_JWT}`],
    ["an id_token_ prefix", `id_token_${SAMPLE_JWT}`],
    ["a random base64url run", `A9zQ${SAMPLE_JWT}`],
    ["a Bearer prefix with no space", `Bearer${SAMPLE_JWT}`],
    ["a ghs_ installation-token prefix", GHS_GLUED],
    ["an \\x3d escaped equals", `state=x\\x3d${SAMPLE_JWT}`],
  ];

  for (const [label, input] of glued) {
    it(`leaves a JWT glued to ${label} untouched`, () => {
      expect(apply(input)).toBe(input);
    });
  }
});

// §0a's sharpest row: github_token DOES fire on ghs_<appid>_<jwt>, so findings
// is non-empty and a naive "was the string modified?" assertion passes while the
// whole JWT leaks. Assert the signature bytes, through the real pipeline.
describe("jwt detector — no other detector covers the §5 loss class", () => {
  it("leaves the JWT signature in cleartext behind a ghs_ prefix", () => {
    const { redacted, findings } = redactWithFindings(GHS_GLUED);
    const fired = findings.map((finding) => finding.name);

    expect(fired).toContain("github_token");
    expect(fired).not.toContain("jwt");
    expect(redacted).toContain("SflKxwRJSMeKKF2QT4");
  });
});

const jwtOf = (headerPad: number, payloadPad: number, sigLen: number): string => {
  const header = `eyJhbGciOiJIUzI1NiJ9${"H".repeat(headerPad)}`;
  const payload = `eyJzdWIiOiIxMjM0NTY3ODkwIn0${"P".repeat(payloadPad)}`;
  return `${header}.${payload}.${"S".repeat(sigLen)}`;
};

// Expected values were captured by running the PRE-FIX quadratic pattern over
// these same inputs outside the repo (fix spec §6.1) and frozen as literals, so
// the old pattern never enters CI. Assertions are pattern-level, not through
// redact(): bearer_token sits at index 5 and jwt at index 6, so in the real
// pipeline bearer_token consumes the Authorization case before jwt sees it.
const EQUIVALENCE: ReadonlyArray<readonly [string, string, string]> = [
  ["hs256_minimal", SAMPLE_JWT, "eyJ[REDACTED]"],
  ["rs256_typical", jwtOf(40, 120, 342), "eyJ[REDACTED]"],
  ["rs512_large_sig", jwtOf(40, 120, 684), "eyJ[REDACTED]"],
  ["id_token_8kb_payload", jwtOf(40, 8192, 342), "eyJ[REDACTED]"],
  ["payload_16kb", jwtOf(40, 16384, 342), "eyJ[REDACTED]"],
  ["x5c_header_3kb", jwtOf(3072, 120, 342), "eyJ[REDACTED]"],
  ["carrier_equals", `token=${SAMPLE_JWT}`, "token=eyJ[REDACTED]"],
  ["carrier_colon", `token:${SAMPLE_JWT}`, "token:eyJ[REDACTED]"],
  ["carrier_dquote", `"${SAMPLE_JWT}"`, '"eyJ[REDACTED]"'],
  ["carrier_semicolon", `a=1;${SAMPLE_JWT}`, "a=1;eyJ[REDACTED]"],
  ["carrier_space", `token ${SAMPLE_JWT}`, "token eyJ[REDACTED]"],
  ["carrier_newline", `line1\n${SAMPLE_JWT}`, "line1\neyJ[REDACTED]"],
  ["carrier_start_of_string", `${SAMPLE_JWT} trailing`, "eyJ[REDACTED] trailing"],
  ["bearer_header", `Authorization: Bearer ${SAMPLE_JWT}`, "Authorization: Bearer eyJ[REDACTED]"],
  ["segments_with_dash_and_underscore", DASH_UNDERSCORE_JWT, "eyJ[REDACTED]"],
  ["alg_none_minimal", ALG_NONE_JWT, "eyJ[REDACTED]"],
  ["two_jwts_in_one_input", `a=${SAMPLE_JWT} b=${SAMPLE_JWT}`, "a=eyJ[REDACTED] b=eyJ[REDACTED]"],
  ["carrier_percent_upper_hex", `state=x%3D${SAMPLE_JWT}`, "state=x%3DeyJ[REDACTED]"],
  ["carrier_percent_lower_hex", `state=x%3d${SAMPLE_JWT}`, "state=x%3deyJ[REDACTED]"],
  ["carrier_percent_ampersand", `a=b%26${SAMPLE_JWT}`, "a=b%26eyJ[REDACTED]"],
  ["carrier_percent_space", `q=%20${SAMPLE_JWT}`, "q=%20eyJ[REDACTED]"],
];

describe("jwt detector — output frozen against the pre-fix pattern (fix spec §6.1)", () => {
  for (const [label, input, expected] of EQUIVALENCE) {
    it(`redacts ${label} byte-identically to the pre-fix pattern`, () => {
      expect(apply(input)).toBe(expected);
    });
  }
});

// Every fixture in the equivalence corpus above carries an `eyJ`-prefixed
// payload, because real JWTs do — so none of them notices if the payload's
// `eyJ` anchor or a segment's `+` is dropped. Both mutations only ever ADD
// matches, which is exactly what the corpus cannot see and what the
// strict-subset-of-the-pre-fix-pattern invariant forbids: over-redaction strips
// evidence the model needs to decide. Each row here is redacted by one such
// mutant and left untouched by the shipped and pre-fix patterns alike.
describe("jwt detector — strict subset of the pre-fix pattern, no over-redaction", () => {
  const nonMatches: ReadonlyArray<readonly [string, string]> = [
    ["a dotted non-eyJ payload", "trace eyJhbGciOiJIUzI1NiJ9.session.abc123"],
    ["a dotted bundle filename", "see eyJlogger.v2.min bundle"],
    ["an empty header segment", "eyJ.eyJa.b"],
    ["an empty payload segment", "eyJa.eyJ.b"],
    ["an empty signature segment", "eyJa.eyJb."],
    ["every segment empty", "eyJ.eyJ."],
  ];

  for (const [label, input] of nonMatches) {
    it(`leaves ${label} untouched`, () => {
      expect(apply(input)).toBe(input);
    });
  }
});
