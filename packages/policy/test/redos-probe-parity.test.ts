import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs measurement script with no type declarations.
import * as probe from "../../../scripts/redos-probe.mjs";
import { OBSERVED_PATTERNS, REDACTION_PATTERNS } from "../src/redaction-patterns.js";

// `scripts/redos-probe.mjs` reproduces every timing figure the redaction specs
// cite, and it hand-writes the regexes it measures. Those copies drift, and a
// drifted copy does not fail — it quietly benchmarks a pattern that does not
// ship, and the number lands in a spec looking exactly like a real one.
//
// Confirmed instance: the probe's `connection_string_secret` carried a `pwd`
// field in its alternation for months after `pwd` was dropped from production
// (it collides with the universal `$PWD`, which appears in every env dump).
// Every figure that row produced described a regex that does not exist.
//
// This compares the probe's real RegExp objects — imported, not parsed out of
// the file text — against the shipped table. The probe guards its CLI dispatch
// behind an entry-point check so importing it here has no side effects; without
// that guard a bare import runs `timing`, which takes tens of minutes.
//
// SCOPE: this catches a probe row that LIES about what ships. It does not
// require the probe to COVER every shipped detector. 28 of the 41 rows are
// probed; the 13 without a seed are jwt, github_token, anthropic_key,
// openai_key, aws_access_key, bearer_token, env_value, url_query_secret,
// cli_secret_flag_eq, cli_secret_flag_spaced, credit_card, iban and
// tr_national_id. A new detector added with no probe row is therefore still
// unmeasured — a coverage question, deliberately left open, not a
// truthfulness one.

// One namespace import, so the export list below is read from the same object
// the rows come from — a second dynamic `import()` would need its own
// suppression and could, in principle, resolve differently.
const probeModule = probe as {
  AFTER?: Record<string, RegExp>;
  NEW_DETECTORS?: Record<string, { re: RegExp }>;
};
const { AFTER, NEW_DETECTORS } = probeModule;

const shipped = new Map(
  [...REDACTION_PATTERNS, ...OBSERVED_PATTERNS].map((p) => [p.name, p.pattern] as const),
);

// `?? {}` so a dropped or renamed export fails the non-vacuity test below with
// a message naming the problem, instead of crashing module load with a bare
// "Cannot convert undefined or null to object".
const rowsOf = (table: string, obj: unknown, pick: (v: never) => RegExp) =>
  Object.entries((obj ?? {}) as Record<string, never>).map(
    ([name, v]) => [table, name, pick(v)] as [string, string, RegExp],
  );

const probeRows: Array<[string, string, RegExp]> = [
  ...rowsOf("AFTER", AFTER, (re: never) => re as unknown as RegExp),
  ...rowsOf("NEW_DETECTORS", NEW_DETECTORS, (v: never) => (v as { re: RegExp }).re),
];

describe("redos-probe.mjs measures what actually ships", () => {
  // Non-vacuity. Both tables are imported from another file; if an export were
  // renamed or dropped, `Object.entries` would yield nothing and every
  // it.each below would silently vanish, leaving a green suite that checks
  // nothing. This is the same trap a seed that matches nothing sets, and the
  // probe already guards against that one.
  it("imported both probe tables with rows in each", () => {
    expect(Object.keys((AFTER ?? {}) as object).length).toBeGreaterThanOrEqual(7);
    expect(Object.keys((NEW_DETECTORS ?? {}) as object).length).toBeGreaterThanOrEqual(21);
    expect(probeRows.length).toBeGreaterThanOrEqual(28);
  });

  it.each(probeRows)("%s.%s matches the shipped pattern byte for byte", (_table, name, re) => {
    const ship = shipped.get(name);
    // A probe row naming a detector that no longer exists is drift too — it
    // means a rename landed in production and not here.
    expect(ship, `${name} is not a shipped detector name`).toBeDefined();
    expect(re.source).toBe(ship?.source);
    expect(re.flags).toBe(ship?.flags);
  });

  // The `BEFORE` and `CARRIER_BEFORE` tables are deliberately NOT checked here:
  // they hold the superseded patterns, whose whole purpose is to differ from
  // what ships. They are also unexported, so this cannot drift into asserting
  // over them by accident.
  it("does not accidentally reach the historical tables", () => {
    expect(Object.keys(probe as object).sort()).toEqual(["AFTER", "NEW_DETECTORS"]);
  });
});
