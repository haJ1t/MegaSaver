import type { Session } from "@megasaver/core";
import { useEffect, useState } from "react";
import { fetchSessions } from "../lib/api-client.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; sessions: Session[] }
  | { kind: "error"; message: string };

export function SessionsView(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchSessions()
      .then((sessions) => {
        if (!cancelled) setState({ kind: "ready", sessions });
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

  if (state.kind === "loading") return <p>loading sessions…</p>;
  if (state.kind === "error") return <p role="alert">error: {state.message}</p>;
  if (state.sessions.length === 0) return <p>no sessions</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>id</th>
          <th>title</th>
          <th>agent</th>
          <th>risk</th>
          <th>status</th>
          <th>started</th>
        </tr>
      </thead>
      <tbody>
        {state.sessions.map((session) => (
          <tr key={session.id}>
            <td>{session.id}</td>
            <td>{session.title ?? "-"}</td>
            <td>{session.agentId}</td>
            <td>{session.riskLevel}</td>
            <td>{session.endedAt === null ? "open" : "ended"}</td>
            <td>{session.startedAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
