import { describe, expect, it } from "vitest";
import { redactForLedger, redactWithFindings } from "../src/redact.js";
import { OBSERVED_PATTERNS, REDACTION_PATTERNS } from "../src/redaction-patterns.js";

// Instances 4 and 5 of wiki/concepts/unbounded-run-redos.md.
//
// Instance 5 — three lookbehinds hold a variable-length `\s` run. V8 evaluates a
// lookbehind RIGHT TO LEFT, so the TRAILING run is the first element tried: at
// every start position it consumes the whole preceding whitespace run, requires
// the delimiter (`=`, `[:=]`, `basic`), fails, and gives back one character at a
// time. O(run) work at O(n) start positions.
//
// Instance 4 — `email`'s `[A-Za-z0-9._%+-]+@` is the plain class/literal form:
// an unbounded greedy run followed by a required literal that never arrives.
//
// Measured per-pattern with `String.replace`, 50 KB -> 100 KB, before the fix:
//   aws_secret_key      2,206 ->  9,412 ms   (space run)
//   basic_auth_header   1,894 ->  8,350 ms   (space run)
//   api_key_header      1,280 ->  7,606 ms   (space run)
//   api_key_header      1,245 -> 18,178 ms   (` \t` alternation)
//   email               6,049 -> 23,098 ms   (`a` run)
//
// Reachable without crafting: apps/cli/src/commands/handoff/open.ts:98 redacts a
// whole git diff, packages/context-gate/src/record-output.ts:162 redacts raw
// tool output, and neither has a size cap ahead of it. Column-padded tables and
// tab-indented logs are the whitespace shapes; minified/identifier blobs are the
// `email` shape.
const SIZE = 50_000;
const DOUBLE = 100_000;

// A growth RATIO, not a wall-clock ceiling: the prior art in this class recorded
// four of five reverted bounds staying green under a 5 s ceiling at 50 KB
// (wiki/concepts/unbounded-run-redos.md, "Lesson for the guard test"). The ratio
// is load- and runtime-independent. Bounded is linear (~2.0x per doubling);
// unbounded measured 3.8x-4.7x through this function at these sizes.
const MAX_GROWTH = 2.75;

// min-of-TRIALS, not mean: scheduler noise can only ever INFLATE a duration, so
// a spike in the 100 KB sample inflates that trial's ratio and a spike in the
// 50 KB sample deflates it. The minimum discards inflated trials and can only
// make the assertion harder to pass.
const TRIALS = 5;

// Calibrated repeats, not a fixed count. Vitest cannot interrupt a synchronous
// loop — its `timeout` only fires at async boundaries — so a fixed count would
// multiply the pathological call and hang instead of going red. Deriving the
// count from one real call spends ~60 ms per sample when bounded and drops to a
// single repeat when not.
const TARGET_SAMPLE_MS = 60;

const repeatsFor = (input: string): number => {
  redactWithFindings(input);
  const started = performance.now();
  redactWithFindings(input);
  const one = performance.now() - started;
  return Math.max(1, Math.round(TARGET_SAMPLE_MS / Math.max(one, 0.05)));
};

const sample = (input: string, repeats: number): number => {
  const started = performance.now();
  for (let i = 0; i < repeats; i += 1) redactWithFindings(input);
  return performance.now() - started;
};

const growthRatio = (shape: (size: number) => string): number => {
  const small = shape(SIZE);
  const large = shape(DOUBLE);
  const repeats = repeatsFor(small);
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    best = Math.min(best, sample(large, repeats) / sample(small, repeats));
  }
  return best;
};

// Which shape separates which bound, measured by reverting each bound ALONE and
// re-running these three cases (all four are therefore load-bearing):
//
//   aws_secret_key   `\s{0,64}` -> `\s*`   space run  3.77x  (tab run stayed green)
//   api_key_header   `\s{0,64}` -> `\s*`   tab run    3.89x  (space run stayed green)
//   basic_auth_head  `\s{1,64}` -> `\s+`   space 3.76x, tab 3.79x
//   email            `{1,64}`   -> `+`     letter run 3.52x
//
// The first two rows are why BOTH whitespace shapes are here. A single one would
// have let one of the two reverted bounds through: on the shape it does not
// separate, the reverted pattern still runs 65-100 s at these sizes while its
// ratio lands under the threshold. Keep both.
const SHAPES: ReadonlyArray<readonly [string, (size: number) => string]> = [
  // Column-padded output. Drives all three instance-5 lookbehinds at once.
  ["a space run", (size) => " ".repeat(size)],
  // Tab-indented logs. Same three, different `\s` member.
  ["a tab run", (size) => "\t".repeat(size)],
  // A minified/identifier blob. Drives `email` — every character is in the
  // local-part class and no `@` ever arrives.
  ["a letter run", (size) => "a".repeat(size)],
];

describe("redactWithFindings — ReDoS regression at 100 KB", () => {
  for (const [label, shape] of SHAPES) {
    it(`grows no worse than ${MAX_GROWTH}x from ${SIZE / 1000} KB to ${
      DOUBLE / 1000
    } KB of ${label}`, () => {
      expect(growthRatio(shape)).toBeLessThan(MAX_GROWTH);
    }, 600_000);
  }
});

// The bounds must not change what gets redacted. Every expectation below was
// captured from the UNBOUNDED patterns before the fix, so these lock behaviour
// rather than describe it: they pass identically before and after.
describe("secrets are still redacted", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    [
      "an aws credentials assignment",
      "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "aws_secret_access_key = [REDACTED]",
    ],
    [
      "an aws credentials assignment with no spaces",
      "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "aws_secret_access_key=[REDACTED]",
    ],
    ["an x-api-key header", "x-api-key: 8f3b21ccae5d4f0a9b17", "x-api-key: [REDACTED]"],
    [
      "an x-auth-token header written as an assignment",
      'x-auth-token="8f3b21ccae5d4f0a9b17"',
      "x-auth-token=[REDACTED]",
    ],
    [
      "an x-access-token header padded to a column",
      "x-access-token        :        8f3b21ccae5d4f0a9b17",
      "x-access-token        :        [REDACTED]",
    ],
    [
      "an Authorization Basic header",
      "Authorization: Basic dXNlcjpwYXNzd29yZA==",
      "Authorization: Basic [REDACTED]",
    ],
    [
      "an Authorization Basic header with wide padding",
      `Authorization:${" ".repeat(20)}Basic${" ".repeat(20)}dXNlcjpwYXNzd29yZA==`,
      `Authorization:${" ".repeat(20)}Basic${" ".repeat(20)}[REDACTED]`,
    ],
    [
      "an aws credentials assignment inside a padded config block",
      `aws_secret_access_key${" ".repeat(30)}=${" ".repeat(
        30,
      )}wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`,
      `aws_secret_access_key${" ".repeat(30)}=${" ".repeat(30)}[REDACTED]`,
    ],
  ];

  for (const [label, input, expected] of cases) {
    it(`redacts ${label}`, () => {
      expect(redactWithFindings(input).redacted).toBe(expected);
    });
  }

  it("still counts an email without modifying it", () => {
    const result = redactWithFindings("author jane.doe+ci@sub.corp.example.com wrote");

    expect(result.redacted).toBe("author jane.doe+ci@sub.corp.example.com wrote");
    expect(result.observed).toEqual([{ name: "email", count: 1 }]);
  });

  // redactForLedger runs the SAME OBSERVED_PATTERNS array and actually replaces
  // (F-FW-1: an email must never persist into a ledger sourcePath label). It is
  // the second caller the email bound has to keep correct — a size gate on the
  // observer loop would have fixed redactWithFindings and left this one both
  // quadratic and, once gated, leaking.
  it("still scrubs an email from a ledger label", () => {
    expect(redactForLedger("git log --author=jane.doe+ci@corp.example.com")).toBe(
      "git log --author=[REDACTED:email]",
    );
  });
});

// Equivalence over the shapes that used to match. The unbounded originals are
// transcribed here verbatim from the pre-fix source; the assertion is that the
// shipped pattern produces byte-identical output on every corpus line.
describe("bounded patterns agree with the unbounded originals", () => {
  const UNBOUNDED: ReadonlyArray<readonly [string, RegExp]> = [
    ["aws_secret_key", /(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}/g],
    [
      "api_key_header",
      /(?<=(?:x-api-key|x-auth-token|x-access-token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s"']{8,})/gi,
    ],
    ["basic_auth_header", /(?<=authorization\s*[:=]\s*basic\s+)[A-Za-z0-9+/=]{8,}/gi],
    ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ];

  const shipped = (name: string): RegExp => {
    const entry = [...REDACTION_PATTERNS, ...OBSERVED_PATTERNS].find((p) => p.name === name);
    if (entry === undefined) throw new Error(`${name} missing from the pattern tables`);
    return entry.pattern;
  };

  const SECRET40 = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const B64 = "dXNlcjpwYXNzd29yZA==";
  const TOKEN = "8f3b21ccae5d4f0a9b17";

  // Every separator form the `\s` runs are supposed to accept, at every width a
  // real log or config file produces, plus the exact shapes each pattern's
  // alternation branches exist for.
  const corpus: readonly string[] = [
    ...["", " ", "  ", "\t", " \t ", "\n", "\r\n", " ".repeat(8), " ".repeat(64)].flatMap((gap) => [
      `aws_secret_access_key${gap}=${gap}${SECRET40}`,
      `x-api-key${gap}:${gap}${TOKEN}`,
      `x-auth-token${gap}=${gap}${TOKEN}`,
      `X-Access-Token${gap}:${gap}"${TOKEN}"`,
      `x-api-key${gap}:${gap}'${TOKEN}'`,
      `Authorization${gap}:${gap}Basic${gap || " "}${B64}`,
      `authorization${gap}=${gap}basic${gap || " "}${B64}`,
    ]),
    "no secrets here at all",
    "aws_secret_access_key = tooshort",
    "x-api-key: short",
    "Authorization: Bearer notbasic",
    "a@b.co",
    "jane.doe+ci@sub.corp.example.com",
    "UPPER.Case_99%tag@ex-ample.co.uk",
    "not-an-email@",
    "@nolocal.com",
    "trailing.dot@example.",
    "mail to jane@a.io and joe@b.dev in one line",
    // Exactly at the bound — still identical. The over-long case diverges by
    // design and is pinned separately below.
    `${"x".repeat(64)}@example.com`,
    `user@${"d".repeat(200)}.com`,
  ];

  for (const [name, original] of UNBOUNDED) {
    it(`${name} matches the same substrings as before`, () => {
      const bounded = shipped(name);
      for (const line of corpus) {
        original.lastIndex = 0;
        bounded.lastIndex = 0;

        expect([line, line.replace(bounded, "<M>")]).toEqual([line, line.replace(original, "<M>")]);
      }
    });
  }
});

// The two deliberate divergences, pinned so they are decisions and not
// surprises. Both sit outside the range any real input occupies.
describe("the disclosed divergences", () => {
  // RFC 5321 §4.5.3.1.1 caps a local part at 64 octets, so nothing deliverable
  // is affected. And because `{1,64}` is still greedy WITH backtracking, an
  // over-long run does not stop matching — the match simply starts later, at
  // the same `@`. The count is therefore unchanged, which is what the observer
  // reports.
  it("counts an over-long local part exactly once, as before", () => {
    const line = `${"x".repeat(200)}@example.com`;

    expect(redactWithFindings(line).observed).toEqual([{ name: "email", count: 1 }]);
  });

  it("scrubs only the last 64 characters of an over-long local part in a ledger label", () => {
    expect(redactForLedger(`${"x".repeat(80)}@example.com`)).toBe(
      `${"x".repeat(16)}[REDACTED:email]`,
    );
  });

  // More than 64 whitespace characters between a key and its value. A key name
  // plus 65 columns of padding already overflows an 80-column terminal, so no
  // real config or header dump reaches this.
  // This pinned the disclosed loss of the BOUND fix (`\s{0,64}`): an assignment
  // whose `=` was followed by more than 64 whitespace characters stopped
  // redacting. That fix was superseded by a leading lookahead guard, which
  // removes the quadratic without giving up any input — measured 0.1 ms against
  // 8.1 ms bounded on a whitespace run — so the loss no longer exists and the
  // assertion is inverted rather than deleted. See §5a's `§` footnote (kept, and
  // marked superseded) and the `◆` amendment.
  it("still redacts past 64 characters of padding — the bound's loss is gone", () => {
    const line = `aws_secret_access_key =${" ".repeat(65)}wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`;

    expect(redactWithFindings(line).redacted).not.toBe(line);
    expect(redactWithFindings(line).redacted).not.toContain("wJalrXUtnFEMI");
  });
});
