import type { TranscriptEntry } from "@megasaver/agent-office";

// In-process pub/sub for live transcript entries. The supervisor runs in the
// same process as the bridge, so an agent's drain publishes here and any open
// SSE stream for that agent receives the entry with no fs-watch latency.
type Listener = (entry: TranscriptEntry) => void;

const subscribers = new Map<string, Set<Listener>>();

export function transcriptKey(workspaceKey: string, officeAgentId: string): string {
  return `${workspaceKey}:${officeAgentId}`;
}

export function subscribeTranscript(key: string, cb: Listener): () => void {
  let set = subscribers.get(key);
  if (set === undefined) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(cb);
  return () => {
    const current = subscribers.get(key);
    if (current === undefined) return;
    current.delete(cb);
    if (current.size === 0) subscribers.delete(key);
  };
}

export function publishTranscript(key: string, entry: TranscriptEntry): void {
  const set = subscribers.get(key);
  if (set === undefined) return;
  for (const cb of set) {
    try {
      cb(entry);
    } catch {
      // a slow/broken subscriber must not block the others
    }
  }
}
