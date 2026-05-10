// First 8 hex chars of a UUID; shared across views/forms so the slice
// length stays consistent if it ever changes.
export function shortId(id: string): string {
  return id.slice(0, 8);
}
