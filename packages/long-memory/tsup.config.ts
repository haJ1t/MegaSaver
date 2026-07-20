import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/stdio.ts",
    "src/lm2-benchmark.ts",
    "src/lm2-benchmark-manifest.ts",
    "src/lm2-benchmark-canonical.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
});
