import { describe, it, expect } from 'vitest';
import { createMeshHandle, resolveMeshHandle } from '../src/mesh-handle.js';

describe('mesh-handle', () => {
  it('creates canonical mesh://<hash> handle and resolves CAS reference', () => {
    const payload = 'export const TOKEN_LIMIT = 4000;';
    const handle = createMeshHandle(payload);

    expect(handle.uri).toMatch(/^mesh:\/\/[0-9a-f]{16}$/);
    expect(handle.sizeBytes).toBe(payload.length);

    const store = new Map<string, string>([[handle.uri, payload]]);
    const resolved = resolveMeshHandle(handle.uri, store);
    expect(resolved).toBe(payload);
  });
});
