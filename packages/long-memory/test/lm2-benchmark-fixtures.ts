import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256 } from "../src/lm2-benchmark-canonical.js";
import { buildBenchmarkManifest } from "../src/lm2-benchmark-manifest.js";

const roots: string[] = [];

export function cleanupBenchmarkRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function benchmarkFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-benchmark-")));
  roots.push(root);
  chmodSync(root, 0o700);
  const cacheParent = join(root, "public-cache");
  mkdirSync(cacheParent, { mode: 0o700 });
  const trajectories = [
    {
      id: "trajectory-one",
      states: [{ accessibility_tree: "billing status is paid" }],
    },
    {
      id: "trajectory-two",
      content: [{ observation: { text: "request approval is pending" } }],
    },
  ];
  const manifest = buildBenchmarkManifest({
    domain: "web",
    tier: "small",
    checksums: {
      schema: "0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f",
      questions: "0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7",
      trajectories: "363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6",
      haystack: "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593",
    },
    questions: [
      {
        id: "question-one",
        domain: "web",
        environment: "shop",
        question_type: "dynamic-environment",
        question: "What is the billing status?",
        image: null,
        answer: "paid",
        eval_function: "private",
      },
    ],
    haystack: { "question-one": trajectories.map(({ id }) => id) },
    trajectories,
  });
  const manifestPath = join(root, "megasaver-lm2-manifest-v1.json");
  writeFileSync(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600, flag: "wx" });
  return {
    root,
    cacheParent,
    manifest,
    manifestPath,
    manifestDigest: canonicalSha256(manifest),
    trajectories,
    instanceToken: "1".repeat(32),
    config: {
      manifestPath,
      manifestDigest: canonicalSha256(manifest),
      dataRevision: manifest.data.revision,
      cacheParent,
      profile: "adaptive" as const,
      embeddingEgress: "local" as const,
      model: {
        provider: "local",
        modelId: "megasaver-hash-embedding",
        revision: "v1",
        dimensions: 64,
        embeddingInputVersion: "lm2-v1" as const,
      },
      tokenBudget: 2_000,
      queryTimeoutMs: 1_500,
      indexBatchTimeoutMs: 15_000,
    },
  };
}
