import { describe, it, expect } from 'vitest';
import { prefetchToLocalCache, getPrefetchedContent } from '../src/speculative-prefetch.js';

describe('speculative-prefetch', () => {
  it('prefetches strictly to local cache without mutating prompt stream', () => {
    const cache = new Map<string, string>();
    const handleUri = 'mesh://abc123def4567890';
    const payload = 'cached context payload';

    prefetchToLocalCache(handleUri, payload, cache);
    expect(getPrefetchedContent(handleUri, cache)).toBe(payload);
    expect(cache.has(handleUri)).toBe(true);
  });
});
