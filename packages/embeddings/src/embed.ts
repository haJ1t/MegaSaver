const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// Minimal local shape of the slice of @huggingface/transformers we call. Typing
// the dynamic import loosely (this interface + an `as` cast below) keeps `tsc`
// from requiring the optional dep's types — the package typechecks even when
// @huggingface/transformers is absent (it lives in optionalDependencies).
type Tensor = { data: Float32Array; dims: number[] };
type FeatureExtractor = (
  texts: readonly string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<Tensor>;
type TransformersModule = {
  pipeline: (task: "feature-extraction", model: string) => Promise<FeatureExtractor>;
};

// @huggingface/transformers (and its native onnxruntime-node) is heavy and
// downloads ~50MB on first use. Load it lazily, exactly once, so a plain
// `import("@megasaver/embeddings")` never pays for it — only an actual embed()
// call does. Mirrors the lazy TS-compiler load in output-filter/semantic.ts.
let extractorPromise: Promise<FeatureExtractor> | undefined;
async function getExtractor(): Promise<FeatureExtractor> {
  if (extractorPromise === undefined) {
    extractorPromise = import("@huggingface/transformers").then((mod) =>
      (mod as unknown as TransformersModule).pipeline("feature-extraction", MODEL_ID),
    );
  }
  return extractorPromise;
}

export async function embed(texts: readonly string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const tensor = await extractor(texts, { pooling: "mean", normalize: true });
  const [rows, dim] = tensor.dims as [number, number];
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) {
    out.push(tensor.data.slice(i * dim, (i + 1) * dim));
  }
  return out;
}
