// B4 divergence runner: measures bytes/4 vs cl100k_base over real repo
// corpora (code / prose / JSON / Turkish) and writes the report JSON that
// Track A's admission-guard threshold derives from.
// Run: node packages/bench-replay/scripts/measure-token-divergence.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureTokenDivergence } from "../dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const cat = (rels) => rels.map(read).join("\n");

const corpora = [
  {
    name: "code",
    text: cat([
      "packages/stats/src/store.ts",
      "packages/stats/src/event.ts",
      "packages/output-filter/src/rank.ts",
      "packages/context-gate/src/fetch-chunk.ts",
    ]),
  },
  {
    name: "prose",
    text: cat(["docs/getting-started.md", "docs/cli-reference.md", "docs/benchmarks.md"]),
  },
  {
    name: "json",
    text: cat(["packages/stats/package.json", "tsconfig.base.json", "biome.json", "turbo.json"]),
  },
  {
    name: "turkish",
    text: read("wiki/sources/fikri-original.md"),
  },
];

const report = await measureTokenDivergence(corpora);
report.measuredAt = new Date().toISOString();
report.corpusFiles = corpora.map((c) => c.name);

const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "token-divergence-report.json");
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

for (const s of report.samples) {
  console.log(
    `${s.name.padEnd(8)} bytes=${String(s.bytes).padStart(7)}  est=${String(s.estimatedTokens).padStart(6)}  real=${String(s.realTokens).padStart(6)}  real/est=${s.realOverEstimate.toFixed(3)}`,
  );
}
console.log(`overall  real/est=${report.overallRealOverEstimate.toFixed(3)}`);
console.log(`wrote ${outPath}`);
