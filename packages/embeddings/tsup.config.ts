import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
  // Keep the optional, native, platform-specific ML dep OUT of the bundle so
  // the lazy `import("@huggingface/transformers")` stays a real runtime import
  // resolved from node_modules — never inlined (which would ship ~1.8MB of JS +
  // wrong-OS onnxruntime .node binaries and defeat the lazy/optional design).
  external: ["@huggingface/transformers"],
});
