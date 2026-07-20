import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embeddingInputDigest, modelDescriptorFingerprint } from "../src/lm2-identity.js";
import type { Lm2Candidate, ModelDescriptor } from "../src/lm2-model.js";
import {
  MAX_LM2_SIDECARS_PER_NAMESPACE,
  MAX_LM2_SIDECAR_BYTES,
  MAX_LM2_WORKSPACE_VECTOR_BYTES,
  createLm2VectorStore,
} from "../src/lm2-vector-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-vectors-")));
  roots.push(root);
  return root;
}

function createModel(index = 0, dimensions = 3): ModelDescriptor {
  return {
    provider: "local",
    modelId: `test-model-${index}`,
    revision: "r1",
    dimensions,
    embeddingInputVersion: "lm2-v1",
  };
}

function createCandidate(index = 0): Lm2Candidate {
  const suffix = index.toString(16).padStart(12, "0");
  const id = `00000000-0000-4000-8000-${suffix}`;
  return {
    id,
    workspaceKey,
    observedAt: "2026-07-20T00:00:00.000Z",
    kind: "state_snapshot",
    text: `Billing status ${index} is paid.`,
    sourceDigest: createHash("sha256").update(id).digest("hex"),
  };
}

function vectorBase64(values: readonly number[]): string {
  const bytes = Buffer.alloc(values.length * Float32Array.BYTES_PER_ELEMENT);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes.toString("base64");
}

function sidecarValue(candidate: Lm2Candidate, model: ModelDescriptor, vector: readonly number[]) {
  return {
    schemaVersion: 1,
    workspaceKey: candidate.workspaceKey,
    recordId: candidate.id,
    kind: candidate.kind,
    sourceDigest: candidate.sourceDigest,
    embeddingInputDigest: embeddingInputDigest({ kind: candidate.kind, text: candidate.text }),
    model,
    dimension: model.dimensions,
    vectorBase64: vectorBase64(vector),
  };
}

function sidecarPath(root: string, candidate: Lm2Candidate, model: ModelDescriptor): string {
  return join(
    root,
    "long-memory",
    "v1",
    candidate.workspaceKey,
    "embeddings",
    modelDescriptorFingerprint(model),
    `${candidate.id}.json`,
  );
}

function seedSidecar(
  root: string,
  candidate: Lm2Candidate,
  model: ModelDescriptor,
  vector: readonly number[],
): void {
  const path = sidecarPath(root, candidate, model);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sidecarValue(candidate, model, vector))}\n`);
}

function seedRawSidecar(
  root: string,
  candidate: Lm2Candidate,
  model: ModelDescriptor,
  raw: string,
): void {
  const path = sidecarPath(root, candidate, model);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, raw);
}

function embeddingResult(model: ModelDescriptor, vectors: readonly (readonly number[])[]) {
  return {
    modelFingerprint: modelDescriptorFingerprint(model),
    vectors,
  };
}

function indexLockPath(root: string): string {
  return join(root, "long-memory", "v1", workspaceKey, ".lm2", "index-v1.lock");
}

function holdIndexLock(path: string): Promise<() => Promise<void>> {
  mkdirSync(join(path, ".."), { recursive: true });
  const script = [
    'import { closeSync, openSync } from "node:fs";',
    'import { flockSync } from "fs-ext";',
    'const descriptor = openSync(process.argv[1], "a+");',
    'flockSync(descriptor, "exnb");',
    'process.stdout.write("locked\\n");',
    'process.stdin.once("data", () => { closeSync(descriptor); process.exit(0); });',
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, path], {
      cwd: packageDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.stdout.once("data", (chunk: Buffer) => {
      if (chunk.toString() !== "locked\n") {
        reject(new Error(`Index lock child did not acquire lock: ${stderr}`));
        return;
      }
      resolve(
        () =>
          new Promise<void>((release, rejectRelease) => {
            child.once("error", rejectRelease);
            child.once("close", (code) => {
              if (code === 0) release();
              else rejectRelease(new Error(stderr));
            });
            child.stdin.end("release\n");
          }),
      );
    });
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM2 vector sidecars", () => {
  it("publishes canonical identity-bound sidecars and reads verified Float32 vectors", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();
    const store = createLm2VectorStore({ storeRoot: root });
    const embed = vi.fn(async () => embeddingResult(model, [[3, 4, 0]]));

    await expect(
      store.reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [record.id], reason: null });
    expect(embed).toHaveBeenCalledWith({
      model,
      purpose: "document",
      texts: [
        `megasaver.long-memory.lm2.embedding-input.v1\0${JSON.stringify({
          kind: record.kind,
          text: record.text,
        })}`,
      ],
      signal: expect.any(AbortSignal),
    });
    const raw = readFileSync(sidecarPath(root, record, model), "utf8");
    expect(raw).toBe(`${JSON.stringify(sidecarValue(record, model, [3, 4, 0]))}\n`);
    await expect(
      store.readVerified({
        workspaceKey,
        model,
        candidates: [record],
        maxDecodedBytes: 64 * 1024 * 1024,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([{ candidateId: record.id, vector: [3, 4, 0], decodedBytes: 12 }]);
  });

  it("rejects malformed, noncanonical, tuple-mismatched, and invalid Float32 sidecars", async () => {
    const root = createRoot();
    const model = createModel();
    const candidates = Array.from({ length: 13 }, (_, index) => createCandidate(index));
    const values = candidates.map((candidate) => sidecarValue(candidate, model, [1, 2, 3]));
    seedRawSidecar(root, candidates[0] as Lm2Candidate, model, "{malformed");
    seedRawSidecar(
      root,
      candidates[1] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[1], vectorBase64: "AAAA" })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[2] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[2], workspaceKey: "fedcba9876543210" })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[3] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[3], recordId: candidates[4]?.id })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[4] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[4], sourceDigest: "f".repeat(64) })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[5] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[5], kind: "state_transition" })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[6] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[6], embeddingInputDigest: "e".repeat(64) })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[7] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[7], model: createModel(9) })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[8] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[8], dimension: 2 })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[9] as Lm2Candidate,
      model,
      `${JSON.stringify({ ...values[9], vectorBase64: vectorBase64([0, 0, 0]) })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[10] as Lm2Candidate,
      model,
      `${JSON.stringify({
        ...values[10],
        vectorBase64: vectorBase64([Number.POSITIVE_INFINITY, 0, 1]),
      })}\n`,
    );
    seedRawSidecar(
      root,
      candidates[11] as Lm2Candidate,
      model,
      `${JSON.stringify(values[11], null, 2)}\n`,
    );
    seedSidecar(root, candidates[12] as Lm2Candidate, model, [1, 2, 3]);
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.readVerified({
        workspaceKey,
        model,
        candidates,
        maxDecodedBytes: 64 * 1024 * 1024,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([{ candidateId: candidates[12]?.id, vector: [1, 2, 3], decodedBytes: 12 }]);
  });

  it("rejects oversized sidecars before parsing and honors the decoded-byte budget", async () => {
    const root = createRoot();
    const model = createModel();
    const first = createCandidate(1);
    const second = createCandidate(2);
    const oversized = createCandidate(3);
    seedSidecar(root, first, model, [1, 2, 3]);
    seedSidecar(root, second, model, [4, 5, 6]);
    seedRawSidecar(root, oversized, model, "x".repeat(MAX_LM2_SIDECAR_BYTES + 1));
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.readVerified({
        workspaceKey,
        model,
        candidates: [first, second, oversized],
        maxDecodedBytes: 12,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([{ candidateId: first.id, vector: [1, 2, 3], decodedBytes: 12 }]);
  });

  it("supports the bounded 10,000-candidate read surface rather than the 256-index cap", async () => {
    const root = createRoot();
    const model = createModel();
    const candidates = Array.from({ length: 257 }, (_, index) => createCandidate(index));
    seedSidecar(root, candidates[256] as Lm2Candidate, model, [1, 2, 3]);

    await expect(
      createLm2VectorStore({ storeRoot: root }).readVerified({
        workspaceKey,
        model,
        candidates,
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([{ candidateId: candidates[256]?.id, vector: [1, 2, 3], decodedBytes: 12 }]);
  });

  it("rejects symlinked sidecar reads and performs no egress through a symlinked vector root", async () => {
    const root = createRoot();
    const outside = createRoot();
    const model = createModel();
    const record = createCandidate();
    const path = sidecarPath(root, record, model);
    mkdirSync(join(path, ".."), { recursive: true });
    const outsideFile = join(outside, "sidecar.json");
    writeFileSync(outsideFile, `${JSON.stringify(sidecarValue(record, model, [1, 2, 3]))}\n`);
    symlinkSync(outsideFile, path);
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.readVerified({
        workspaceKey,
        model,
        candidates: [record],
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([]);

    const secondRoot = createRoot();
    const workspace = join(secondRoot, "long-memory", "v1", workspaceKey);
    mkdirSync(workspace, { recursive: true });
    symlinkSync(outside, join(workspace, "embeddings"));
    const embed = vi.fn();
    await expect(
      createLm2VectorStore({ storeRoot: secondRoot }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(embed).not.toHaveBeenCalled();

    const thirdRoot = createRoot();
    const thirdWorkspace = join(thirdRoot, "long-memory", "v1", workspaceKey);
    const embeddings = join(thirdWorkspace, "embeddings");
    const outsideNamespace = join(outside, "namespace");
    mkdirSync(embeddings, { recursive: true });
    mkdirSync(outsideNamespace, { recursive: true });
    writeFileSync(
      join(outsideNamespace, `${record.id}.json`),
      `${JSON.stringify(sidecarValue(record, model, [1, 2, 3]))}\n`,
    );
    symlinkSync(outsideNamespace, join(embeddings, modelDescriptorFingerprint(model)));
    const namespaceEmbed = vi.fn();
    await expect(
      createLm2VectorStore({ storeRoot: thirdRoot }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: namespaceEmbed,
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(namespaceEmbed).not.toHaveBeenCalled();
  });

  it.each([
    { name: "Float32 overflow", vector: [1e39, 0, 1] },
    { name: "nonfinite", vector: [Number.NaN, 0, 1] },
    { name: "zero norm", vector: [0, 0, 0] },
    { name: "wrong dimension", vector: [1, 2] },
  ])("publishes nothing for $name embedding output", async ({ vector }) => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () => embeddingResult(model, [vector]),
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    expect(existsSync(sidecarPath(root, record, model))).toBe(false);
  });

  it("publishes nothing for a mismatched fingerprint or vector tuple", async () => {
    const root = createRoot();
    const model = createModel();
    const records = [createCandidate(1), createCandidate(2)];
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.reserveAndPublish({
        workspaceKey,
        model,
        records,
        signal: new AbortController().signal,
        embed: async () => ({ modelFingerprint: "f".repeat(64), vectors: [[1, 2, 3]] }),
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    expect(records.every((record) => !existsSync(sidecarPath(root, record, model)))).toBe(true);
  });

  it("treats a malformed embedding result as invalid vectors without publishing", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () => ({}) as never,
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    expect(existsSync(sidecarPath(root, record, model))).toBe(false);

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () =>
          Object.defineProperty({}, "modelFingerprint", {
            get() {
              throw new Error("hostile getter");
            },
          }) as never,
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    expect(existsSync(sidecarPath(root, record, model))).toBe(false);
  });

  it("discards an embedding result delivered after abort", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();
    const controller = new AbortController();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: controller.signal,
        embed: async () => {
          controller.abort();
          return embeddingResult(model, [[1, 2, 3]]);
        },
      }),
    ).resolves.toEqual({ published: [], reason: "port_failure" });
    expect(existsSync(sidecarPath(root, record, model))).toBe(false);
  });

  it("does not egress when a third descriptor namespace exceeds quota", async () => {
    const root = createRoot();
    seedSidecar(root, createCandidate(1), createModel(1), [1, 2, 3]);
    seedSidecar(root, createCandidate(2), createModel(2), [1, 2, 3]);
    const store = createLm2VectorStore({ storeRoot: root });
    const embed = vi.fn();

    await expect(
      store.reserveAndPublish({
        workspaceKey,
        model: createModel(3),
        records: [createCandidate(3)],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("returns index_busy to a second process without scan, egress, or writes", async () => {
    const root = createRoot();
    const release = await holdIndexLock(indexLockPath(root));
    const store = createLm2VectorStore({ storeRoot: root });
    const embed = vi.fn();
    try {
      await expect(
        store.reserveAndPublish({
          workspaceKey,
          model: createModel(),
          records: [createCandidate()],
          signal: new AbortController().signal,
          embed,
        }),
      ).resolves.toEqual({ published: [], reason: "index_busy" });
      expect(embed).not.toHaveBeenCalled();
      expect(() => readFileSync(sidecarPath(root, createCandidate(), createModel()))).toThrow();
    } finally {
      await release();
    }
  });

  it("returns index_lock_unavailable without egress when the advisory lock cannot open", async () => {
    const root = createRoot();
    mkdirSync(indexLockPath(root), { recursive: true });
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model: createModel(),
        records: [createCandidate()],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "index_lock_unavailable" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("does not let crash partials or invalid sidecars reserve namespace quota forever", async () => {
    const root = createRoot();
    const first = createModel(1);
    const second = createModel(2);
    const requested = createModel(3);
    const firstDirectory = join(sidecarPath(root, createCandidate(1), first), "..");
    const secondDirectory = join(sidecarPath(root, createCandidate(2), second), "..");
    mkdirSync(firstDirectory, { recursive: true });
    mkdirSync(secondDirectory, { recursive: true });
    writeFileSync(join(firstDirectory, ".crash.tmp"), "partial");
    writeFileSync(join(secondDirectory, `${createCandidate(2).id}.json`), "{invalid");
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.reserveAndPublish({
        workspaceKey,
        model: requested,
        records: [createCandidate(3)],
        signal: new AbortController().signal,
        embed: async () => embeddingResult(requested, [[1, 2, 3]]),
      }),
    ).resolves.toEqual({ published: [createCandidate(3).id], reason: null });
  });

  it("reserves the worst-case sidecar size before crossing the 10,000-record cap", async () => {
    const root = createRoot();
    const model = createModel(0, 1);
    for (let index = 0; index < MAX_LM2_SIDECARS_PER_NAMESPACE; index += 1) {
      seedSidecar(root, createCandidate(index), model, [1]);
    }
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [createCandidate(MAX_LM2_SIDECARS_PER_NAMESPACE)],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("reserves 24 KiB per planned sidecar before crossing the 128-MiB workspace cap", async () => {
    const root = createRoot();
    const model = createModel(0, 4_096);
    const vector = Array.from({ length: model.dimensions }, () => 1);
    let serializedBytes = 0;
    let index = 0;
    while (serializedBytes <= MAX_LM2_WORKSPACE_VECTOR_BYTES - MAX_LM2_SIDECAR_BYTES) {
      const candidate = createCandidate(index);
      const raw = `${JSON.stringify(sidecarValue(candidate, model, vector))}\n`;
      seedRawSidecar(root, candidate, model, raw);
      serializedBytes += Buffer.byteLength(raw, "utf8");
      index += 1;
    }
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [createCandidate(index)],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  }, 30_000);

  it("uses atomic no-clobber publication when a conflicting sidecar appears during egress", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();
    const conflicting = "foreign-content\n";
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () => {
          seedRawSidecar(root, record, model, conflicting);
          return embeddingResult(model, [[1, 2, 3]]);
        },
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(readFileSync(sidecarPath(root, record, model), "utf8")).toBe(conflicting);
  });
});
