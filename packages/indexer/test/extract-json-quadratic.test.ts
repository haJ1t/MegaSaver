import { describe, expect, it } from "vitest";
import { extractJson } from "../src/extract/extract-json.js";

// `lineOf` used to compile a fresh RegExp and re-scan every line for each
// top-level key, so a flat dictionary cost O(keys x lines) — quadratic in file
// size. Flat dictionaries are not an exotic shape: i18n locale files, config
// maps and data dumps are all one big top-level object, and every read path
// reaches this function uncapped (`filterOutput` -> `chunkBySemantic` on any
// `.json` read via proxy_read_file / mega output read) or capped only at
// DEFAULT_MAX_FILE_SIZE (`mega scan` / `mega index`, scan.ts:20).
//
// 1 MB is that shipped cap, so it IS the worst case for the indexer path.
// Measured through extractJson on the locale shape below: 2755 ms quadratic vs
// 24 ms one-pass.
const SCAN_CAP_BYTES = 1_000_000;

// The control is the SAME OBJECT minified. Same keys, same values, so every
// per-key cost that is not the defect — sha256, tokenize, block allocation,
// JSON.parse — is identical in both samples and cancels in the ratio. The only
// difference is line count: 19k lines pretty-printed, 1 line minified, and the
// defect's cost is keys x lines. Quadratic, the pretty form costs 20.5x the
// minified one at 192 KB, 40.9x at 383 KB, 79.0x at 958 KB; one-pass it costs
// 1.10x / 1.13x / 1.43x (the residue is the line split and one regex exec per
// line, which the single-line control does not pay).
//
// A wall-clock ceiling was tried first and rejected: the one-pass call is 24 ms
// idle but was measured at 1137 ms inside a full parallel `pnpm verify`, a ~47x
// spread that leaves no room between it and the 2755 ms defect. A ratio of two
// adjacent measurements in the same process is what survives that load — both
// samples slow down together. Ratio guards fail when the band is narrow (see
// wiki/concepts/unbounded-run-redos.md, instance 6); this band is 1.43x to
// 79.0x, and 5x sits 3.5x above the fast form and 15x below the defect.
const MAX_PRETTY_TO_MINIFIED = 5;

const localeEntries = (bytes: number): Record<string, string> => {
  const entries: Record<string, string> = {};
  let size = 2;
  for (let i = 0; size < bytes; i++) {
    const key = `app.section${i % 50}.label_${i}`;
    const value = `Value number ${i}`;
    entries[key] = value;
    size += key.length + value.length + 11;
  }
  return entries;
};

// Min over trials, interleaved: scheduler noise and a cold first call can only
// inflate a sample, so the minimum discards them from both sides of the ratio.
const fastest = (run: () => void): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < 3; trial++) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
};

describe("extractJson — quadratic key-line scan at the 1 MB file cap", () => {
  // `retry: 3`, matching every other timing guard in this repo
  // (output-filter/dedupe-quadratic, core/project-rule-ranking, policy/glob-redos).
  // min-of-trials cancels a spike inside one run, but it cannot cancel sustained
  // load: under a full parallel `pnpm verify` the pretty sample runs long enough
  // to accumulate far more preemption than the one-line control, so the ratio
  // inflates on one-pass code — measured 22.9x against this 5x gate while passing
  // 3/3 in isolation. Retrying does not weaken the gate: the quadratic form is
  // slow on every attempt, so it still fails all three.
  it(`costs under ${MAX_PRETTY_TO_MINIFIED}x the same object on one line`, { retry: 3 }, () => {
    const entries = localeEntries(SCAN_CAP_BYTES);
    const pretty = JSON.stringify(entries, null, 2);
    const minified = JSON.stringify(entries);

    const prettyMs = fastest(() => void extractJson("locales/en.json", pretty));
    const minifiedMs = fastest(() => void extractJson("locales/en.json", minified));

    expect(extractJson("locales/en.json", pretty)).toHaveLength(Object.keys(entries).length);
    expect(prettyMs / minifiedMs).toBeLessThan(MAX_PRETTY_TO_MINIFIED);
  });

  // The single-pass rewrite keeps first-occurrence-wins, including the quirk
  // that a nested key on an earlier line beats the top-level key of the same
  // name. Pinned so a future "proper" position parser is a decision, not a
  // silent line-number shift.
  it("still resolves a shadowed key to its first anchored occurrence", () => {
    const json = '{\n  "a": {\n    "x": 1\n  },\n  "x": 2\n}\n';

    expect(extractJson("c.json", json).find((b) => b.name === "x")?.startLine).toBe(3);
  });
});
