import { useEffect, useState } from "react";

type LiveSession = {
  liveSessionId: string;
  agent: string;
  cwdShort: string;
  branch?: string;
  task?: string;
  lastSeenAt: string;
  status: "working" | "blocked" | "done";
  burn: number | null;
  claimWarnings: number;
};

type LiveTable = {
  version: 1;
  sessions: LiveSession[];
  total: number;
};

function statusColor(status: LiveSession["status"]): string {
  if (status === "working") return "text-emerald-600";
  if (status === "blocked") return "text-amber-600";
  return "text-zinc-500";
}

export function SessionsLivePanel(): JSX.Element {
  const [table, setTable] = useState<LiveTable | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchOnce = async (): Promise<void> => {
      try {
        const res = await fetch("/api/sessions/live");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as LiveTable;
        if (alive) {
          setTable(data);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (error) return <div className="p-4 text-sm text-red-600">sessions: {error}</div>;
  if (!table) return <div className="p-4 text-sm text-zinc-500">loading sessions…</div>;
  if (table.sessions.length === 0)
    return <div className="p-4 text-sm text-zinc-500">no live sessions</div>;

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold mb-2">Live sessions ({table.total})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-2 py-1">id</th>
              <th className="px-2 py-1">agent</th>
              <th className="px-2 py-1">cwd</th>
              <th className="px-2 py-1">status</th>
              <th className="px-2 py-1">burn</th>
              <th className="px-2 py-1">claims</th>
            </tr>
          </thead>
          <tbody>
            {table.sessions.map((s) => (
              <tr key={s.liveSessionId} className="border-t border-zinc-200">
                <td className="px-2 py-1 font-mono text-xs">{s.liveSessionId.slice(0, 8)}</td>
                <td className="px-2 py-1">{s.agent}</td>
                <td className="px-2 py-1 font-mono text-xs">{s.cwdShort}</td>
                <td className={`px-2 py-1 ${statusColor(s.status)}`}>{s.status}</td>
                <td className="px-2 py-1">{s.burn === null ? "n/a" : String(s.burn)}</td>
                <td className="px-2 py-1">{s.claimWarnings > 0 ? `⚠ ${s.claimWarnings}` : "0"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
