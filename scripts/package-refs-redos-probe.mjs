import { performance } from "node:perf_hooks";
// Committed timing harness for the package-refs extractor (wiki
// concepts/redos-guard-testing "commit the harness"). Regenerates every
// quoted figure: run `pnpm --filter @megasaver/context-gate build` first,
// then `node scripts/package-refs-redos-probe.mjs`.
import { extractPackageRefs } from "../packages/context-gate/dist/index.js";

const npmSource = { kind: "source", ecosystem: "npm" };
const CAP = 262_144;

const SHAPES = [
  ["unclosed from-specifier flood", (size) => 'from "a'.repeat(Math.ceil(size / 7)).slice(0, size)],
  ["unclosed quote all-word flood", (size) => `from "${"a".repeat(size)}`],
  ["single repeated word char", (size) => "x".repeat(size)],
  [
    "unclosed require-call flood",
    (size) => "require('p".repeat(Math.ceil(size / 10)).slice(0, size),
  ],
  ["quote flood", (size) => '"'.repeat(size)],
];

function minMs(input, repeats) {
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < 5; trial += 1) {
    const started = performance.now();
    for (let r = 0; r < repeats; r += 1) extractPackageRefs(npmSource, input);
    const ms = (performance.now() - started) / repeats;
    if (ms < best) best = ms;
  }
  return best;
}

for (const [label, shape] of SHAPES) {
  const n = Math.floor(CAP / 4);
  const nMs = minMs(shape(n), 1);
  const n4Ms = minMs(shape(CAP), 1);
  console.log(
    `${label}: n(${n})=${nMs.toFixed(2)}ms 4n(${CAP})=${n4Ms.toFixed(2)}ms growth=${(n4Ms / nMs).toFixed(2)}x`,
  );
}
