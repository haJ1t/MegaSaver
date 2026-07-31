export function prefetchToLocalCache(
  uri: string,
  content: string,
  cache: Map<string, string>,
): void {
  cache.set(uri, content);
}

export function getPrefetchedContent(uri: string, cache: Map<string, string>): string | null {
  return cache.get(uri) ?? null;
}
