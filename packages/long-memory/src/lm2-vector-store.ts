import { randomUUID } from "node:crypto";
import {
  type Stats,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import { assertLm1PathIsNotSymlink, lm1WorkspaceDirectory } from "./lm1-paths.js";
import { Lm2Error } from "./lm2-errors.js";
import {
  canonicalFloat32,
  embeddingInputDigest,
  modelDescriptorFingerprint,
} from "./lm2-identity.js";
import { withWorkspaceIndexLock } from "./lm2-lock.js";
import {
  type EmbeddingPort,
  type Lm2Candidate,
  type ModelDescriptor,
  lm2CandidateSchema,
  modelDescriptorSchema,
} from "./lm2-model.js";

export const MAX_LM2_SIDECAR_BYTES = 24 * 1024;
export const MAX_LM2_WORKSPACE_VECTOR_BYTES = 128 * 1024 * 1024;
export const MAX_LM2_VECTOR_NAMESPACES = 2;
export const MAX_LM2_SIDECARS_PER_NAMESPACE = 10_000;
export const MAX_LM2_DECODED_QUERY_VECTOR_BYTES = 64 * 1024 * 1024;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
const sidecarSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceKey: workspaceKeySchema,
    recordId: lowercaseUuidSchema,
    kind: z.enum(["state_snapshot", "state_transition"]),
    sourceDigest: sha256Schema,
    embeddingInputDigest: sha256Schema,
    model: modelDescriptorSchema,
    dimension: z.number().int().min(1).max(4_096),
    vectorBase64: z.string().min(1).max(32_768),
  })
  .strict();
type VectorSidecar = z.infer<typeof sidecarSchema>;

export type Lm2VerifiedVector = {
  candidateId: string;
  vector: readonly number[];
  decodedBytes: number;
};

export type Lm2VectorStoreResult = {
  published: readonly string[];
  reason:
    | null
    | "index_busy"
    | "index_lock_unavailable"
    | "storage_limit"
    | "invalid_vectors"
    | "port_failure"
    | "write_failed";
};

type ReserveAndPublishInput = {
  workspaceKey: string;
  model: ModelDescriptor;
  records: readonly Lm2Candidate[];
  signal: AbortSignal;
  embed: EmbeddingPort["embed"];
};

export type Lm2VectorStore = {
  readVerified(input: {
    workspaceKey: string;
    model: ModelDescriptor;
    candidates: readonly Lm2Candidate[];
    maxDecodedBytes: number;
    signal: AbortSignal;
  }): Promise<readonly Lm2VerifiedVector[]>;
  reserveAndPublish(input: ReserveAndPublishInput): Promise<Lm2VectorStoreResult>;
};

type ParsedSidecar = {
  sidecar: VectorSidecar;
  vector: Float32Array;
  serializedBytes: number;
};

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function existingStat(path: string): Stats | null {
  try {
    const stat = lstatSync(path);
    if (stat === undefined) {
      throw new Lm2Error("store_corrupt", "LM2 vector path is unreadable.");
    }
    return stat;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new Lm2Error("store_corrupt", "LM2 vector path is unreadable.");
  }
}

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncFile(path: string): void {
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncDirectoryChain(finalDirectory: string): void {
  if (process.platform === "win32") return;
  const absolutePath = resolve(finalDirectory);
  const root = parse(absolutePath).root;
  fsyncDirectory(root);
  let current = root;
  for (const segment of relative(root, absolutePath).split(sep).filter(Boolean)) {
    current = join(current, segment);
    fsyncDirectory(current);
  }
}

function ensureDirectory(path: string): void {
  assertLm1PathIsNotSymlink(path);
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    throw new Lm2Error("write_failed", "LM2 vector directory creation failed.");
  }
  const stat = existingStat(path);
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Lm2Error("write_failed", "LM2 vector directory is invalid.");
  }
  syncDirectoryChain(path);
}

function workspaceDirectory(storeRoot: string, workspaceKey: string): string {
  try {
    return lm1WorkspaceDirectory(storeRoot, workspaceKey);
  } catch (error) {
    if (error instanceof Lm1Error && error.code === "invalid_input") {
      throw new Lm2Error("invalid_input", error.message);
    }
    throw new Lm2Error("write_failed", "LM2 workspace path is unavailable.");
  }
}

function indexLockPath(storeRoot: string, workspaceKey: string): string {
  const directory = join(workspaceDirectory(storeRoot, workspaceKey), ".lm2");
  ensureDirectory(directory);
  const path = join(directory, "index-v1.lock");
  try {
    assertLm1PathIsNotSymlink(path);
  } catch {
    throw new Lm2Error("index_lock_unavailable", "LM2 workspace index lock is unavailable.");
  }
  return path;
}

function embeddingsDirectory(storeRoot: string, workspaceKey: string): string {
  return join(workspaceDirectory(storeRoot, workspaceKey), "embeddings");
}

function namespaceDirectory(
  storeRoot: string,
  workspaceKey: string,
  model: ModelDescriptor,
): string {
  return join(embeddingsDirectory(storeRoot, workspaceKey), modelDescriptorFingerprint(model));
}

function sidecarPath(
  storeRoot: string,
  workspaceKey: string,
  model: ModelDescriptor,
  recordId: string,
): string {
  return join(namespaceDirectory(storeRoot, workspaceKey, model), `${recordId}.json`);
}

function parseModel(model: ModelDescriptor): ModelDescriptor {
  const parsed = modelDescriptorSchema.safeParse(model);
  if (!parsed.success) throw new Lm2Error("invalid_input", "Invalid model descriptor.");
  return parsed.data;
}

function parseRecords(
  workspaceKey: string,
  records: readonly Lm2Candidate[],
  maximum: number,
): Lm2Candidate[] {
  const parsedWorkspace = workspaceKeySchema.safeParse(workspaceKey);
  if (!parsedWorkspace.success || records.length > maximum) {
    throw new Lm2Error("invalid_input", "Invalid LM2 vector publish request.");
  }
  const parsed: Lm2Candidate[] = [];
  const ids = new Set<string>();
  for (const record of records) {
    const result = lm2CandidateSchema.safeParse(record);
    if (
      !result.success ||
      result.data.workspaceKey !== parsedWorkspace.data ||
      ids.has(result.data.id)
    ) {
      throw new Lm2Error("invalid_input", "Invalid LM2 vector publish request.");
    }
    ids.add(result.data.id);
    parsed.push(result.data);
  }
  return parsed;
}

function canonicalEmbeddingInput(record: Lm2Candidate): string {
  return `megasaver.long-memory.lm2.embedding-input.v1\0${JSON.stringify({
    kind: record.kind,
    text: record.text,
  })}`;
}

function encodeVector(vector: Float32Array): string {
  const bytes = Buffer.alloc(vector.byteLength);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes.toString("base64");
}

function decodeVector(base64: string, dimension: number): Float32Array | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    return null;
  }
  const bytes = Buffer.from(base64, "base64");
  if (
    bytes.toString("base64") !== base64 ||
    bytes.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT
  ) {
    return null;
  }
  const values = Array.from({ length: dimension }, (_, index) => bytes.readFloatLE(index * 4));
  try {
    return canonicalFloat32(values);
  } catch {
    return null;
  }
}

function serializeSidecar(sidecar: VectorSidecar): string {
  return `${JSON.stringify(sidecar)}\n`;
}

function parseSidecarRaw(raw: Buffer, expectedFingerprint: string): ParsedSidecar | null {
  if (raw.byteLength === 0 || raw.byteLength > MAX_LM2_SIDECAR_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  const parsed = sidecarSchema.safeParse(value);
  if (!parsed.success || serializeSidecar(parsed.data) !== raw.toString("utf8")) return null;
  if (
    parsed.data.dimension !== parsed.data.model.dimensions ||
    modelDescriptorFingerprint(parsed.data.model) !== expectedFingerprint
  ) {
    return null;
  }
  const vector = decodeVector(parsed.data.vectorBase64, parsed.data.dimension);
  if (vector === null) return null;
  return { sidecar: parsed.data, vector, serializedBytes: raw.byteLength };
}

function readParsedSidecar(path: string, expectedFingerprint: string): ParsedSidecar | null {
  const stat = existingStat(path);
  if (
    stat === null ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size === 0 ||
    stat.size > MAX_LM2_SIDECAR_BYTES
  ) {
    return null;
  }
  try {
    return parseSidecarRaw(readFileSync(path), expectedFingerprint);
  } catch {
    return null;
  }
}

function matchesCandidate(
  parsed: ParsedSidecar,
  workspaceKey: string,
  model: ModelDescriptor,
  candidate: Lm2Candidate,
): boolean {
  return (
    parsed.sidecar.workspaceKey === workspaceKey &&
    parsed.sidecar.recordId === candidate.id &&
    parsed.sidecar.kind === candidate.kind &&
    parsed.sidecar.sourceDigest === candidate.sourceDigest &&
    parsed.sidecar.embeddingInputDigest ===
      embeddingInputDigest({ kind: candidate.kind, text: candidate.text }) &&
    JSON.stringify(parsed.sidecar.model) === JSON.stringify(model)
  );
}

type QuotaState = {
  activeNamespaces: Set<string>;
  requestedNamespaceCount: number;
  serializedBytes: number;
};

function inspectQuota(
  storeRoot: string,
  workspaceKey: string,
  requestedFingerprint: string,
): QuotaState {
  const root = embeddingsDirectory(storeRoot, workspaceKey);
  const stat = existingStat(root);
  if (stat === null) {
    return { activeNamespaces: new Set(), requestedNamespaceCount: 0, serializedBytes: 0 };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Lm2Error("write_failed", "LM2 vector directory is invalid.");
  }

  const activeNamespaces = new Set<string>();
  let requestedNamespaceCount = 0;
  let serializedBytes = 0;
  let namespaceNames: string[];
  try {
    namespaceNames = readdirSync(root);
  } catch {
    throw new Lm2Error("write_failed", "LM2 vector quota is unreadable.");
  }
  for (const fingerprint of namespaceNames) {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) continue;
    const directory = join(root, fingerprint);
    const directoryStat = existingStat(directory);
    if (directoryStat === null || directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      if (fingerprint === requestedFingerprint) {
        throw new Lm2Error("write_failed", "LM2 vector namespace is invalid.");
      }
      continue;
    }
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      continue;
    }
    let validCount = 0;
    for (const name of names) {
      const match = /^([0-9a-f-]{36})\.json$/.exec(name);
      if (match === null) continue;
      const parsed = readParsedSidecar(join(directory, name), fingerprint);
      if (
        parsed === null ||
        parsed.sidecar.workspaceKey !== workspaceKey ||
        parsed.sidecar.recordId !== match[1]
      ) {
        continue;
      }
      validCount += 1;
      serializedBytes += parsed.serializedBytes;
    }
    if (validCount > 0) activeNamespaces.add(fingerprint);
    if (fingerprint === requestedFingerprint) requestedNamespaceCount = validCount;
  }
  return { activeNamespaces, requestedNamespaceCount, serializedBytes };
}

function buildSidecar(
  model: ModelDescriptor,
  record: Lm2Candidate,
  vector: Float32Array,
): VectorSidecar {
  return {
    schemaVersion: 1,
    workspaceKey: record.workspaceKey,
    recordId: record.id,
    kind: record.kind,
    sourceDigest: record.sourceDigest,
    embeddingInputDigest: embeddingInputDigest({ kind: record.kind, text: record.text }),
    model,
    dimension: model.dimensions,
    vectorBase64: encodeVector(vector),
  };
}

function publishNoClobber(path: string, serialized: string): void {
  const directory = dirname(path);
  const tempPath = join(directory, `.${randomUUID()}.tmp`);
  try {
    assertLm1PathIsNotSymlink(path);
    writeFileSync(tempPath, serialized, { flag: "wx", mode: 0o600 });
    fsyncFile(tempPath);
    assertLm1PathIsNotSymlink(path);
    linkSync(tempPath, path);
    fsyncDirectory(directory);
  } catch {
    throw new Lm2Error("write_failed", "LM2 vector sidecar publication failed.");
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function prepareVectorDirectory(
  storeRoot: string,
  workspaceKey: string,
  model: ModelDescriptor,
): void {
  const embeddings = embeddingsDirectory(storeRoot, workspaceKey);
  ensureDirectory(embeddings);
  ensureDirectory(namespaceDirectory(storeRoot, workspaceKey, model));
}

function existingRecordState(
  storeRoot: string,
  workspaceKey: string,
  model: ModelDescriptor,
  record: Lm2Candidate,
): "missing" | "valid" | "invalid" {
  const path = sidecarPath(storeRoot, workspaceKey, model, record.id);
  const stat = existingStat(path);
  if (stat === null) return "missing";
  const parsed = readParsedSidecar(path, modelDescriptorFingerprint(model));
  return parsed !== null && matchesCandidate(parsed, workspaceKey, model, record)
    ? "valid"
    : "invalid";
}

export function createLm2VectorStore({
  storeRoot,
}: {
  storeRoot: string;
}): Lm2VectorStore {
  return {
    async readVerified({ workspaceKey, model, candidates, maxDecodedBytes, signal }) {
      const parsedModel = parseModel(model);
      const parsedCandidates = parseRecords(
        workspaceKey,
        candidates,
        MAX_LM2_SIDECARS_PER_NAMESPACE,
      );
      if (
        !Number.isInteger(maxDecodedBytes) ||
        maxDecodedBytes < 0 ||
        maxDecodedBytes > MAX_LM2_DECODED_QUERY_VECTOR_BYTES
      ) {
        throw new Lm2Error("invalid_input", "Invalid LM2 vector read budget.");
      }
      const fingerprint = modelDescriptorFingerprint(parsedModel);
      const directory = namespaceDirectory(storeRoot, workspaceKey, parsedModel);
      const directoryStat = existingStat(directory);
      if (directoryStat === null) return [];
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Lm2Error("store_corrupt", "LM2 vector namespace is invalid.");
      }

      const verified: Lm2VerifiedVector[] = [];
      let decodedBytes = 0;
      for (const candidate of parsedCandidates) {
        if (signal.aborted) return [];
        const parsed = readParsedSidecar(
          sidecarPath(storeRoot, workspaceKey, parsedModel, candidate.id),
          fingerprint,
        );
        if (parsed === null || !matchesCandidate(parsed, workspaceKey, parsedModel, candidate)) {
          continue;
        }
        if (decodedBytes + parsed.vector.byteLength > maxDecodedBytes) continue;
        decodedBytes += parsed.vector.byteLength;
        verified.push({
          candidateId: candidate.id,
          vector: [...parsed.vector],
          decodedBytes: parsed.vector.byteLength,
        });
      }
      return signal.aborted ? [] : verified;
    },

    async reserveAndPublish(input) {
      let lockPath: string;
      try {
        lockPath = indexLockPath(storeRoot, input.workspaceKey);
      } catch (error) {
        const reason = error instanceof Lm2Error ? error.code : "index_lock_unavailable";
        return {
          published: [],
          reason: reason === "invalid_input" ? "write_failed" : "index_lock_unavailable",
        };
      }
      try {
        return await withWorkspaceIndexLock(lockPath, async () => {
          let model: ModelDescriptor;
          let records: Lm2Candidate[];
          try {
            model = parseModel(input.model);
            records = parseRecords(input.workspaceKey, input.records, 256);
          } catch {
            return { published: [], reason: "write_failed" } as const;
          }
          const fingerprint = modelDescriptorFingerprint(model);
          let quota: QuotaState;
          try {
            quota = inspectQuota(storeRoot, input.workspaceKey, fingerprint);
          } catch {
            return { published: [], reason: "write_failed" } as const;
          }
          const planned: Lm2Candidate[] = [];
          for (const record of records) {
            const state = existingRecordState(storeRoot, input.workspaceKey, model, record);
            if (state === "invalid") {
              return { published: [], reason: "write_failed" } as const;
            }
            if (state === "missing") planned.push(record);
          }
          if (planned.length === 0) return { published: [], reason: null } as const;

          const isNewNamespace = !quota.activeNamespaces.has(fingerprint);
          if (
            quota.activeNamespaces.size + (isNewNamespace ? 1 : 0) > MAX_LM2_VECTOR_NAMESPACES ||
            quota.requestedNamespaceCount + planned.length > MAX_LM2_SIDECARS_PER_NAMESPACE ||
            quota.serializedBytes + planned.length * MAX_LM2_SIDECAR_BYTES >
              MAX_LM2_WORKSPACE_VECTOR_BYTES
          ) {
            return { published: [], reason: "storage_limit" } as const;
          }
          if (input.signal.aborted) return { published: [], reason: "port_failure" } as const;

          try {
            prepareVectorDirectory(storeRoot, input.workspaceKey, model);
          } catch {
            return { published: [], reason: "write_failed" } as const;
          }

          let result: Awaited<ReturnType<EmbeddingPort["embed"]>>;
          try {
            result = await input.embed({
              model,
              purpose: "document",
              texts: planned.map(canonicalEmbeddingInput),
              signal: input.signal,
            });
          } catch {
            return { published: [], reason: "port_failure" } as const;
          }
          if (input.signal.aborted) {
            return { published: [], reason: "port_failure" } as const;
          }
          let resultFingerprint: unknown;
          let resultVectors: unknown;
          try {
            resultFingerprint = result.modelFingerprint;
            resultVectors = result.vectors;
          } catch {
            return { published: [], reason: "invalid_vectors" } as const;
          }
          if (
            resultFingerprint !== fingerprint ||
            !Array.isArray(resultVectors) ||
            resultVectors.length !== planned.length
          ) {
            return { published: [], reason: "invalid_vectors" } as const;
          }

          const serialized: string[] = [];
          try {
            for (let index = 0; index < planned.length; index += 1) {
              const values: unknown = resultVectors[index];
              if (!Array.isArray(values) || values.length !== model.dimensions) {
                throw new Lm2Error("invalid_vectors", "Invalid embedding vector tuple.");
              }
              const vector = canonicalFloat32(values);
              const sidecar = serializeSidecar(
                buildSidecar(model, planned[index] as Lm2Candidate, vector),
              );
              if (Buffer.byteLength(sidecar, "utf8") > MAX_LM2_SIDECAR_BYTES) {
                return { published: [], reason: "storage_limit" } as const;
              }
              serialized.push(sidecar);
            }
          } catch {
            return { published: [], reason: "invalid_vectors" } as const;
          }

          const published: string[] = [];
          for (let index = 0; index < planned.length; index += 1) {
            if (input.signal.aborted) return { published, reason: "port_failure" } as const;
            const record = planned[index] as Lm2Candidate;
            try {
              publishNoClobber(
                sidecarPath(storeRoot, input.workspaceKey, model, record.id),
                serialized[index] as string,
              );
            } catch {
              return { published, reason: "write_failed" } as const;
            }
            published.push(record.id);
          }
          return { published, reason: null } as const;
        });
      } catch (error) {
        if (error instanceof Lm2Error && error.code === "index_busy") {
          return { published: [], reason: "index_busy" };
        }
        return { published: [], reason: "index_lock_unavailable" };
      }
    },
  };
}
