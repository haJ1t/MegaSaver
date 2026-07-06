import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/headline.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
});
