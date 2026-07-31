import { createHash } from 'node:crypto';

export interface MeshHandle {
  uri: string;
  contentHash: string;
  sizeBytes: number;
}

export function createMeshHandle(content: string): MeshHandle {
  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return {
    uri: `mesh://${contentHash}`,
    contentHash,
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
  };
}

export function resolveMeshHandle(uri: string, store: Map<string, string>): string | null {
  return store.get(uri) ?? null;
}
