import { useEffect, useState } from "react";
import {
  type SkillPackItem,
  fetchSkillPacks,
  installSkillPack,
} from "../lib/claude-sessions-client.js";

export function SkillPacksCard(): JSX.Element {
  const [packs, setPacks] = useState<SkillPackItem[]>([]);

  useEffect(() => {
    fetchSkillPacks()
      .then((res) => setPacks(res.packs))
      .catch(() => setPacks([]));
  }, []);

  const onInstall = async (packId: string) => {
    try {
      await installSkillPack(packId);
      setPacks((prev) => prev.map((p) => (p.id === packId ? { ...p, installed: true } : p)));
    } catch {
      // Ignore
    }
  };

  if (packs.length === 0) return <></>;

  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-surface text-xs mt-3">
      <div className="flex items-center justify-between font-semibold text-text-primary">
        <span>Skill Packs</span>
        <span className="text-[10px] text-accent font-mono">Agent Behavior Overlays</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {packs.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between p-2 rounded-md border border-border bg-surface-elevated"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-primary">{p.name}</span>
              <span className="text-[10px] text-text-muted font-mono">v{p.version}</span>
            </div>
            {p.installed ? (
              <span className="text-[10px] text-accent font-semibold">Active</span>
            ) : (
              <button
                type="button"
                onClick={() => onInstall(p.id)}
                className="px-2 py-0.5 rounded-md border border-border bg-surface text-xs cursor-pointer hover:bg-surface-elevated"
              >
                Install
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
