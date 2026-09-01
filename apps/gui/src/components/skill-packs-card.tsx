import { useEffect, useState } from "react";
import {
  type SkillPackItem,
  fetchSkillPacks,
  installSkillPack,
} from "../lib/claude-sessions-client.js";

export function SkillPacksCard(): JSX.Element {
  const [packs, setPacks] = useState<SkillPackItem[]>([]);
  const [installingId, setInstallingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSkillPacks()
      .then((res) => setPacks(res.packs))
      .catch(() => setPacks([]));
  }, []);

  const onInstall = async (packId: string) => {
    try {
      setInstallingId(packId);
      await installSkillPack(packId);
      setPacks((prev) => prev.map((p) => (p.id === packId ? { ...p, installed: true } : p)));
    } catch {
      // Ignore
    } finally {
      setInstallingId(null);
    }
  };

  if (packs.length === 0) return <></>;

  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-surface text-xs">
      <div className="flex items-center justify-between font-semibold text-text-primary">
        <span>Skill Packs</span>
        <span className="text-[10px] text-accent font-mono">Agent Behavior Overlays</span>
      </div>
      <div className="flex flex-col gap-2">
        {packs.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between p-2 rounded-md border border-border bg-surface-elevated"
          >
            <div className="flex flex-col gap-0.5 max-w-[75%]">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary">{p.name}</span>
                <span className="text-[10px] text-text-muted font-mono">v{p.version}</span>
              </div>
            </div>
            {p.installed ? (
              <span className="px-2 py-0.5 rounded text-[11px] bg-accent/15 text-accent font-medium">
                ✓ Active
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onInstall(p.id)}
                disabled={installingId === p.id}
                className="px-2.5 py-1 rounded-md border border-border bg-surface text-xs cursor-pointer hover:bg-surface-elevated disabled:opacity-50 font-medium"
              >
                {installingId === p.id ? "Installing…" : "Install"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
