import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { embeddingInputDigest, modelDescriptorFingerprint } from "../src/lm2-identity.js";
import type { Lm2Candidate, ModelDescriptor } from "../src/lm2-model.js";

export const roots: string[] = [];
export const workspaceKey = "0123456789abcdef";
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const repositoryDirectory = fileURLToPath(new URL("../../..", import.meta.url));

export function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-vectors-")));
  // #region debug log
  if (process.platform === "win32") {
    fetch("https://debug-agent-remote.aidenbai.workers.dev/s/H5tarNgjtoGj02225eBFV", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "H5tarNgjtoGj02225eBFV",
        hypothesisId: "H8",
        location: "lm2-vector-store-fixtures.ts:createRoot",
        message: "root-map",
        data: {
          root,
          test: expect.getState().currentTestName,
          worker: process.env["VITEST_WORKER_ID"], // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion
  roots.push(root);
  return root;
}

export function cleanupRoots(): void {
  // #region debug log
  if (process.platform === "win32") {
    fetch("https://debug-agent-remote.aidenbai.workers.dev/s/H5tarNgjtoGj02225eBFV", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "H5tarNgjtoGj02225eBFV",
        hypothesisId: "H9",
        location: "lm2-vector-store-fixtures.ts:cleanupRoots",
        message: "cleanup",
        data: { count: roots.length, test: expect.getState().currentTestName },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function createModel(index = 0, dimensions = 3): ModelDescriptor {
  return {
    provider: "local",
    modelId: `test-model-${index}`,
    revision: "r1",
    dimensions,
    embeddingInputVersion: "lm2-v1",
  };
}

export function createCandidate(index = 0): Lm2Candidate {
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

export function vectorBase64(values: readonly number[]): string {
  const bytes = Buffer.alloc(values.length * Float32Array.BYTES_PER_ELEMENT);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes.toString("base64");
}

export function sidecarValue(
  candidate: Lm2Candidate,
  model: ModelDescriptor,
  vector: readonly number[],
) {
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

export function sidecarPath(root: string, candidate: Lm2Candidate, model: ModelDescriptor): string {
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

export function seedSidecar(
  root: string,
  candidate: Lm2Candidate,
  model: ModelDescriptor,
  vector: readonly number[],
): void {
  seedRawSidecar(
    root,
    candidate,
    model,
    `${JSON.stringify(sidecarValue(candidate, model, vector))}\n`,
  );
}

export function seedRawSidecar(
  root: string,
  candidate: Lm2Candidate,
  model: ModelDescriptor,
  raw: string,
): void {
  const path = sidecarPath(root, candidate, model);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, raw);
}

export function embeddingResult(model: ModelDescriptor, vectors: readonly (readonly number[])[]) {
  return { modelFingerprint: modelDescriptorFingerprint(model), vectors };
}

export function indexLockPath(root: string): string {
  return join(root, "long-memory", "v1", workspaceKey, ".lm2", "index-v1.lock");
}

export function holdIndexLock(path: string): Promise<() => Promise<void>> {
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

export function startRealIndexer(
  root: string,
  model: ModelDescriptor,
  record: Lm2Candidate,
): Promise<() => Promise<unknown>> {
  const tsxCli = join(
    repositoryDirectory,
    "node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs",
  );
  const fixture = fileURLToPath(new URL("./fixtures/lm2-vector-index-child.ts", import.meta.url));
  const encoded = Buffer.from(
    JSON.stringify({ storeRoot: root, workspaceKey, model, record }),
  ).toString("base64url");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, fixture, encoded], {
      cwd: packageDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.stdout.once("data", (chunk: Buffer) => {
      if (chunk.toString() !== "embedding\n") {
        reject(new Error(`Real index child did not reach embedding: ${stderr}`));
        return;
      }
      resolve(
        () =>
          new Promise((release, rejectRelease) => {
            let output = "";
            child.stdout.on("data", (resultChunk: Buffer) => {
              output += resultChunk.toString();
            });
            child.once("error", rejectRelease);
            child.once("close", (code) => {
              if (code === 0) release(JSON.parse(output.trim()));
              else rejectRelease(new Error(stderr));
            });
            child.stdin.end("release\n");
          }),
      );
    });
  });
}
