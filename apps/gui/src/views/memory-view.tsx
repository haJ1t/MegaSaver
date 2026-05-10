import type { MemoryEntry } from "@megasaver/core";
import { useEffect, useState } from "react";
import { fetchMemory } from "../lib/api-client.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; entries: MemoryEntry[] }
  | { kind: "error"; message: string };

const PREVIEW_MAX = 80;

function preview(content: string): string {
  if (content.length <= PREVIEW_MAX) return content;
  return `${content.slice(0, PREVIEW_MAX)}…`;
}

export function MemoryView(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchMemory()
      .then((entries) => {
        if (!cancelled) setState({ kind: "ready", entries });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <p>loading memory entries…</p>;
  if (state.kind === "error") return <p role="alert">error: {state.message}</p>;
  if (state.entries.length === 0) return <p>no memory entries</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>id</th>
          <th>scope</th>
          <th>session</th>
          <th>content</th>
          <th>created</th>
        </tr>
      </thead>
      <tbody>
        {state.entries.map((entry) => (
          <tr key={entry.id}>
            <td>{entry.id}</td>
            <td>{entry.scope}</td>
            <td>{entry.sessionId ?? "-"}</td>
            <td>{preview(entry.content)}</td>
            <td>{entry.createdAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
