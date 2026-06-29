// @huggingface/transformers lives in optionalDependencies and may be absent
// (a failed native onnxruntime build, or a lean install). This ambient
// declaration lets `tsc --noEmit` resolve the lazy `import(...)` specifier in
// embed.ts to `any` whether or not the package is installed, so typecheck never
// depends on the optional dep. embed.ts narrows that `any` with its own local
// interface, so loosening the type here costs no real safety.
declare module "@huggingface/transformers";
