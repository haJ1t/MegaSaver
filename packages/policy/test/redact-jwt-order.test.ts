import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { redactWithFindings } from "../src/redact.js";
import { REDACTION_PATTERNS, type RedactionPattern } from "../src/redaction-patterns.js";

// Monte Carlo behind the `jwt` reorder. A JWT's segments are base64url, so
// `sk-`, `ghp_`, `npm_`, `hvs.` and `pypi-` all occur inside real token bytes
// at rates a fixture corpus will never hit; only a large random sample shows
// what a prefix detector firing inside a segment costs. One hand-written
// fixture (redact-jwt.test.ts) pins the mechanism, this pins the rate.
//
// Default N is a CI floor, not the cited figure. Reproduce the numbers in the
// `jwt` comment and spec §5a with:
//   JWT_ORDER_N=400000 pnpm --filter @megasaver/policy test redact-jwt-order
// Measured at 400,000: old order 481 losses (120 per 100,000 — openai_key 446,
// github_token 19, vault_token 8, npm_token 5, pypi_token 3, and 274 of the 481
// fired `jwt` on a surviving fragment too), shipped order 0.
const { JWT_ORDER_N } = process.env;
const N = Number(JWT_ORDER_N ?? 40_000);

// Batched: one replace over 500 joined tokens costs far less than 500 calls,
// and a chunk that matches its expected form proves every token in it. Only a
// mismatched chunk is re-walked token by token to attribute the loss.
const CHUNK = 500;
const EXPECTED = "eyJ[REDACTED]";

const b64url = (chars: number): string =>
  randomBytes(Math.ceil((chars * 3) / 4) + 2)
    .toString("base64url")
    .slice(0, chars);

// `eyJ` is not decoration: it is the base64url of `{"`, which every real JOSE
// header and JWT claims-set payload starts with, and it is what the detector
// anchors on. The rest is random because the leak this measures depends on the
// token BODY, not on any header field. Signature length 342 = RS256.
const randomJwt = (): string =>
  `eyJ${b64url(33)}.eyJ${b64url(117 + Math.floor(Math.random() * 280))}.${b64url(342)}`;

const runOrder = (
  order: readonly RedactionPattern[],
  text: string,
): { out: string; fired: string[] } => {
  let out = text;
  const fired: string[] = [];
  for (const { name, pattern, replacement, validate } of order) {
    let hits = 0;
    out = out.replace(pattern, (match) => {
      if (validate !== undefined && !validate(match)) return match;
      hits += 1;
      return replacement;
    });
    if (hits > 0) fired.push(name);
  }
  return { out, fired };
};

// The order as it shipped before this reorder: `jwt` immediately after
// `bearer_token`, everything else untouched. Built from the live table rather
// than copied, so it cannot drift into measuring two stale patterns.
const PRE_REORDER: readonly RedactionPattern[] = (() => {
  const jwt = REDACTION_PATTERNS.find((entry) => entry.name === "jwt");
  if (jwt === undefined) throw new Error("jwt detector missing from REDACTION_PATTERNS");
  const rest = REDACTION_PATTERNS.filter((entry) => entry.name !== "jwt");
  const at = rest.findIndex((entry) => entry.name === "bearer_token") + 1;
  if (at === 0) throw new Error("bearer_token detector missing from REDACTION_PATTERNS");
  return [...rest.slice(0, at), jwt, ...rest.slice(at)];
})();

type Tally = { losses: number; attribution: Map<string, number> };

const tally = (
  order: readonly RedactionPattern[],
  tokens: readonly string[],
  joined: string,
  expected: string,
  into: Tally,
): void => {
  if (runOrder(order, joined).out === expected) return;
  for (const token of tokens) {
    const { out, fired } = runOrder(order, token);
    if (out === EXPECTED) continue;
    into.losses += 1;
    for (const name of fired) into.attribution.set(name, (into.attribution.get(name) ?? 0) + 1);
  }
};

const monteCarlo = (n: number): { before: Tally; after: Tally } => {
  const before: Tally = { losses: 0, attribution: new Map() };
  const after: Tally = { losses: 0, attribution: new Map() };
  for (let done = 0; done < n; done += CHUNK) {
    const size = Math.min(CHUNK, n - done);
    const tokens = Array.from({ length: size }, randomJwt);
    const joined = tokens.join("\n");
    const expected = Array.from({ length: size }, () => EXPECTED).join("\n");
    tally(PRE_REORDER, tokens, joined, expected, before);
    tally(REDACTION_PATTERNS, tokens, joined, expected, after);
  }
  return { before, after };
};

let cached: { before: Tally; after: Tally } | undefined;
const results = (): { before: Tally; after: Tally } => {
  if (cached === undefined) cached = monteCarlo(N);
  return cached;
};

const TIMEOUT_MS = 900_000;

describe("jwt ordering — Monte Carlo over crypto-random tokens", () => {
  // Proves the local runner is the shipped pipeline and not a lookalike; every
  // number below is meaningless if these two ever diverge.
  it("runOrder over REDACTION_PATTERNS reproduces redactWithFindings", () => {
    const sample = `a ${randomJwt()} b sk-${"A".repeat(24)} c`;
    expect(runOrder(REDACTION_PATTERNS, sample).out).toBe(redactWithFindings(sample).redacted);
  });

  // ANTI-VACUITY ANCHOR, and the reason this file is not a pin. If the
  // generator stops producing tokens whose bodies collide with a prefix
  // detector, this drops to 0 and the 0-losses assertion below becomes an
  // empty claim. It must stay red against the old order.
  it(`loses tokens in the pre-reorder order (${N} samples)`, { timeout: TIMEOUT_MS }, () => {
    const { before } = results();
    console.log(
      `jwt-order N=${N} pre-reorder losses=${before.losses} ` +
        `attribution=${JSON.stringify(Object.fromEntries(before.attribution))}`,
    );
    expect(before.losses).toBeGreaterThan(0);
    // openai_key is 83% of the measured losses; `sk-` + 20 alphanumerics is
    // by far the likeliest prefix shape to appear inside base64url.
    expect(before.attribution.get("openai_key") ?? 0).toBeGreaterThan(0);
  });

  it(`loses none in the shipped order (${N} samples)`, { timeout: TIMEOUT_MS }, () => {
    const { after } = results();
    expect(after.attribution.size).toBe(0);
    expect(after.losses).toBe(0);
  });
});

// The reorder is NOT a strict superset, and an earlier revision of the §5a
// footnote claimed it was without checking. `jwt`'s third segment
// `[A-Za-z0-9_-]+` is greedy and unbounded, so it swallows any following
// base64url run — including a later detector's INDICATOR when the two are joined
// by zero or more `[A-Za-z0-9_-]` characters. These pin the loss so it cannot be
// rediscovered as a surprise, and pin the separators that make it safe so nobody
// "fixes" it by widening the class.
describe("jwt reorder — the disclosed right-side coverage loss", () => {
  const J =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it.each([
    ["aws_secret_key", `aws_secret_access_key = ${"U".repeat(40)}`, "U".repeat(40)],
    ["bearer_token", `bearer ${"c".repeat(24)}`, "c".repeat(24)],
    ["sendgrid_key", `SG.${"A".repeat(22)}.${"B".repeat(43)}`, "B".repeat(43)],
    ["vault_token", `hvs.${"A".repeat(24)}`, "A".repeat(24)],
  ])("glued to a JWT, %s no longer fires (DISCLOSED loss)", (_name, carrier, secret) => {
    expect(redactWithFindings(`${J}${carrier}`).redacted).toContain(secret);
  });

  // Any separator outside the class terminates jwt's run, so the carrier is safe.
  // This is why no realistic tool-output shape triggers the loss above.
  it.each([[" "], ["\n"], ["\t"], [","], [";"], ['"'], ["/"], ["."], ["="], ["&"], ["|"]])(
    "separated by %j, aws_secret_key still fires",
    (sep) => {
      const input = `${J}${sep}aws_secret_access_key = ${"U".repeat(40)}`;
      expect(redactWithFindings(input).redacted).not.toContain("U".repeat(40));
    },
  );
});
