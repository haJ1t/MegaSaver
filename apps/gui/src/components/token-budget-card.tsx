import { useEffect, useState } from "react";
import {
  type BudgetResponse,
  clearBudget,
  fetchBudget,
  setBudget,
} from "../lib/claude-sessions-client.js";

export function TokenBudgetCard(): JSX.Element {
  const [budget, setBudgetState] = useState<BudgetResponse | null>(null);
  const [limit, setLimit] = useState("5000000");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchBudget()
      .then((res) => {
        setBudgetState(res);
        if (res.monthlyBudgetTokens > 0) setLimit(res.monthlyBudgetTokens.toString());
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to load budget.";
        setErr(msg);
        setBudgetState(null);
      });
  }, []);

  const onUpdate = async () => {
    const val = Number.parseInt(limit, 10);
    if (Number.isNaN(val) || val <= 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await setBudget(val);
      setBudgetState(res);
    } catch (e) {
      const msg =
        e !== null && typeof e === "object" && "error" in (e as Record<string, unknown>)
          ? String((e as { error: string }).error)
          : e instanceof Error
            ? e.message
            : "Failed to update budget.";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await clearBudget();
      setBudgetState(res);
      setLimit("5000000");
    } catch (e) {
      const msg =
        e !== null && typeof e === "object" && "error" in (e as Record<string, unknown>)
          ? String((e as { error: string }).error)
          : e instanceof Error
            ? e.message
            : "Failed to clear budget.";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  if (!budget) {
    if (err !== null) {
      return (
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-surface text-xs">
          <span className="font-semibold text-text-primary">Token Spending Budget</span>
          <span className="text-[11px] text-red-500">{err}</span>
        </div>
      );
    }
    return <></>;
  }

  const isAbsent = budget.status === "absent";
  const isCorrupt = budget.status === "corrupt";
  const rawNote =
    budget.raw !== undefined && budget.monthlyBudgetTokens === 0
      ? " · stored as non-token limit — showing 0 tokens (status ok)"
      : "";

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface text-xs">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">Token Spending Budget</span>
          {isCorrupt ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-red-500/20 text-red-500 font-semibold">
              Corrupt — reset or fix store
            </span>
          ) : isAbsent ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-border text-text-muted font-semibold">
              Not set
            </span>
          ) : budget.isOverBudget ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-red-500/20 text-red-500 font-semibold">
              Over Budget
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-accent-soft text-accent font-semibold">
              {budget.pacePercent}% Used
            </span>
          )}
        </div>
        <span className="text-[11px] text-text-muted">
          Spent: {(budget.spentTokens / 1000000).toFixed(2)}M / Limit:{" "}
          {(budget.monthlyBudgetTokens / 1000000).toFixed(2)}M tokens{rawNote}
          {isAbsent ? " · no persisted budget yet" : ""}
          {isCorrupt ? " · budget file unreadable" : ""}
        </span>
        {err ? <span className="text-[11px] text-red-500">{err}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="px-2 py-1 rounded-md border border-border bg-surface-elevated text-xs w-28"
          placeholder="5000000"
          disabled={busy}
        />
        <button
          type="button"
          onClick={onUpdate}
          className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80"
          disabled={busy}
        >
          {busy ? "Saving…" : "Set Budget"}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80"
          disabled={busy}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
