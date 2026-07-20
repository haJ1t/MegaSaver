import { describe, expect, it } from "vitest";
import { REDACTION_PATTERNS } from "../src/redaction-patterns.js";

const jwtEntry = REDACTION_PATTERNS.find((entry) => entry.name === "jwt");
if (jwtEntry === undefined) throw new Error("jwt detector missing from REDACTION_PATTERNS");

const apply = (input: string): string => input.replace(jwtEntry.pattern, jwtEntry.replacement);

describe("jwt detector — ReDoS structural gate (fix spec §6.2)", () => {
  it("is left-boundary gated by the base64url lookbehind", () => {
    expect(jwtEntry.pattern.source.startsWith("(?<![A-Za-z0-9_-])")).toBe(true);
  });
});

// Wall clock is kept ONLY at 313 KiB: 8,374 ms broken vs 0.45 ms fixed is four
// orders of magnitude, wide enough to survive a Windows runner's GC or AV pause.
// The 39 KiB rung was dropped: a 50 ms ceiling there sits only ~2.3x under the
// broken 113 ms (though ~800x over the 0.06 ms pass value) — too thin, a GC
// pause flips it.
const CEILING_MS = 500;
const SCALE_KIB = 313;

// Three seeds, not one. Narrowing the lookbehind to (?<![A-Za-z0-9]) — the exact
// edit that would undo the §5 trade-off — leaves 'eyJaA0' at 0.46 ms while
// '-eyJaA' costs 7,494 ms and '_eyJaA' costs 7,561 ms. Without the last two the
// quadratic can return with CI green.
const SEEDS = ["eyJaA0", "-eyJaA", "_eyJaA"] as const;

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

// These three are the ACCEPTED loss from the fix spec §5, not a gap. A JWT
// preceded directly by [A-Za-z0-9_-] no longer redacts. Do not "fix" them by
// narrowing the lookbehind to (?<![A-Za-z0-9]): that restores the first two and
// restores the quadratic with them (7,494 ms and 7,561 ms at 313 KiB). The
// hybrid alternation that recovers those first two was measured at 125x the
// simple fix and rejected in the same section.
describe("jwt detector — accepted §5 trade-off, do not narrow the lookbehind", () => {
  const glued: ReadonlyArray<readonly [string, string]> = [
    ["a session- prefix", `session-${SAMPLE_JWT}`],
    ["an id_token_ prefix", `id_token_${SAMPLE_JWT}`],
    ["a random base64url run", `A9zQ${SAMPLE_JWT}`],
  ];

  for (const [label, input] of glued) {
    it(`leaves a JWT glued to ${label} untouched`, () => {
      expect(apply(input)).toBe(input);
    });
  }
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
];

describe("jwt detector — output frozen against the pre-fix pattern (fix spec §6.1)", () => {
  for (const [label, input, expected] of EQUIVALENCE) {
    it(`redacts ${label} byte-identically to the pre-fix pattern`, () => {
      expect(apply(input)).toBe(expected);
    });
  }
});
