import { join } from "node:path";
import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import type { Lm2Candidate, ModelDescriptor } from "./lm2-model.js";
import {
  type DirectoryAnchor,
  closeDirectoryAnchor,
  listAnchoredDirectory,
  openDirectoryAnchor,
  readAnchoredFile,
} from "./lm2-secure-fs.js";
import { writeAnchoredNoClobber } from "./lm2-secure-publish.js";
import {
  MAX_LM2_SIDECAR_BYTES,
  type SidecarMetadata,
  decodeSidecarVector,
  matchesCandidate,
  parseSidecarMetadata,
} from "./lm2-vector-format.js";
import { embeddingsPath, vectorNamespacePath, vectorSidecarName } from "./lm2-vector-paths.js";

export type Lm2VerifiedVector = {
  candidateId: string;
  vector: readonly number[];
  decodedBytes: number;
};

export type QuotaState = {
  activeNamespaces: Set<string>;
  requestedNamespaceCount: number;
  serializedBytes: number;
};

function readMetadata(
  anchor: DirectoryAnchor,
  name: string,
  fingerprint: string,
  missingIsIndeterminate = false,
): SidecarMetadata | null {
  const read = readAnchoredFile(anchor, name, MAX_LM2_SIDECAR_BYTES);
  if (missingIsIndeterminate && read.status === "missing") {
    throw new Lm2Error("store_corrupt", "LM2 quota sidecar disappeared during inspection.");
  }
  if (read.status !== "valid") return null;
  return parseSidecarMetadata(read.raw, fingerprint);
}

export function readVerifiedVectors(input: {
  storeRoot: string;
  workspaceKey: string;
  model: ModelDescriptor;
  candidates: readonly Lm2Candidate[];
  maxDecodedBytes: number;
  signal: AbortSignal;
}): readonly Lm2VerifiedVector[] {
  const fingerprint = modelDescriptorFingerprint(input.model);
  const anchor = openDirectoryAnchor(
    vectorNamespacePath(input.storeRoot, input.workspaceKey, input.model),
    true,
  );
  if (anchor === null) return [];
  try {
    const verified: Lm2VerifiedVector[] = [];
    let decodedBytes = 0;
    for (const candidate of input.candidates) {
      if (input.signal.aborted) return [];
      const metadata = readMetadata(anchor, vectorSidecarName(candidate.id), fingerprint);
      if (
        metadata === null ||
        !matchesCandidate(metadata, input.workspaceKey, input.model, candidate)
      ) {
        continue;
      }
      const vectorBytes = metadata.sidecar.dimension * 4;
      if (decodedBytes + vectorBytes > input.maxDecodedBytes) continue;
      const vector = decodeSidecarVector(metadata);
      if (vector === null) continue;
      decodedBytes += vectorBytes;
      verified.push({ candidateId: candidate.id, vector: [...vector], decodedBytes: vectorBytes });
    }
    return input.signal.aborted ? [] : verified;
  } finally {
    closeDirectoryAnchor(anchor);
  }
}

export function inspectVectorQuota(
  storeRoot: string,
  workspaceKey: string,
  requestedFingerprint: string,
): QuotaState {
  const root = openDirectoryAnchor(embeddingsPath(storeRoot, workspaceKey), true);
  if (root === null) {
    return { activeNamespaces: new Set(), requestedNamespaceCount: 0, serializedBytes: 0 };
  }
  const activeNamespaces = new Set<string>();
  let requestedNamespaceCount = 0;
  let serializedBytes = 0;
  try {
    for (const fingerprint of listAnchoredDirectory(root)) {
      if (!/^[0-9a-f]{64}$/.test(fingerprint)) continue;
      const namespace = openDirectoryAnchor(join(root.path, fingerprint), false);
      if (namespace === null) {
        throw new Lm2Error("store_corrupt", "LM2 vector namespace disappeared.");
      }
      let count = 0;
      try {
        for (const name of listAnchoredDirectory(namespace)) {
          const match = /^([0-9a-f-]{36})\.json$/.exec(name);
          if (match === null) continue;
          const metadata = readMetadata(namespace, name, fingerprint, true);
          if (
            metadata === null ||
            metadata.sidecar.workspaceKey !== workspaceKey ||
            metadata.sidecar.recordId !== match[1] ||
            decodeSidecarVector(metadata) === null
          ) {
            continue;
          }
          count += 1;
          serializedBytes += metadata.serializedBytes;
        }
      } finally {
        closeDirectoryAnchor(namespace);
      }
      if (count > 0) activeNamespaces.add(fingerprint);
      if (fingerprint === requestedFingerprint) requestedNamespaceCount = count;
    }
    return { activeNamespaces, requestedNamespaceCount, serializedBytes };
  } finally {
    closeDirectoryAnchor(root);
  }
}

export function existingVectorState(input: {
  storeRoot: string;
  workspaceKey: string;
  model: ModelDescriptor;
  fingerprint: string;
  candidate: Lm2Candidate;
}): "missing" | "valid" | "invalid" {
  const anchor = openDirectoryAnchor(
    vectorNamespacePath(input.storeRoot, input.workspaceKey, input.model),
    true,
  );
  if (anchor === null) return "missing";
  try {
    const read = readAnchoredFile(
      anchor,
      vectorSidecarName(input.candidate.id),
      MAX_LM2_SIDECAR_BYTES,
    );
    if (read.status === "missing") return "missing";
    if (read.status === "invalid") return "invalid";
    const metadata = parseSidecarMetadata(read.raw, input.fingerprint);
    return metadata !== null &&
      matchesCandidate(metadata, input.workspaceKey, input.model, input.candidate) &&
      decodeSidecarVector(metadata) !== null
      ? "valid"
      : "invalid";
  } finally {
    closeDirectoryAnchor(anchor);
  }
}

export function publishVectorSidecar(
  anchor: DirectoryAnchor,
  candidateId: string,
  serialized: string,
): void {
  writeAnchoredNoClobber(anchor, vectorSidecarName(candidateId), serialized);
}
