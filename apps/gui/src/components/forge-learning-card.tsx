import { useEffect, useState } from "react";
import {
  type ForgeFailuresResponse,
  fetchForgeFailures,
  postForgeLearn,
} from "../lib/claude-sessions-client.js";

export function ForgeLearningCard(): JSX.Element {
  const [data, setData] = useState<ForgeFailuresResponse | null>(null);
  const [learnedRule, setLearnedRule] = useState<string | null>(null);

  useEffect(() => {
    fetchForgeFailures()
      .then((res) => setData(res))
      .catch(() => setData(null));
  }, []);

  const onLearn = async (failureId: string) => {
    try {
      const res = await postForgeLearn(failureId);
      setLearnedRule(`Learned rule: "${res.ruleTitle}"`);
    } catch {
      // Ignore
    }
  };

  if (!data?.failures || data.failures.length === 0) return <></>;

  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-surface text-xs">
      <div className="flex items-center justify-between font-semibold text-text-primary">
        <span>FORGE Failed-Run Learning</span>
        <span className="text-[10px] text-accent font-mono">Auto-Rule Generator</span>
      </div>
      {data.failures.map((f) => (
        <div
          key={f.id}
          className="flex items-center justify-between p-2 rounded-md border border-border bg-surface-elevated"
        >
          <div className="flex flex-col">
            <span className="font-medium text-text-primary">{f.pattern}</span>
            <span className="text-[10px] text-text-muted">Occurrences: {f.occurrences}</span>
          </div>
          <button
            type="button"
            onClick={() => onLearn(f.id)}
            className="px-2.5 py-1 rounded-md border border-border bg-surface text-xs cursor-pointer hover:bg-surface-elevated"
          >
            Convert to Rule
          </button>
        </div>
      ))}
      {learnedRule && <p className="text-xs text-accent font-mono m-0">{learnedRule}</p>}
    </div>
  );
}
