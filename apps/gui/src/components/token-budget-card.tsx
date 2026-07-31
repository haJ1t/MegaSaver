import { useEffect, useState } from "react";
import { type BudgetResponse, fetchBudget, setBudget } from "../lib/claude-sessions-client.js";

export function TokenBudgetCard(): JSX.Element {
  const [budget, setBudgetState] = useState<BudgetResponse | null>(null);
  const [limit, setLimit] = useState("5000000");

  useEffect(() => {
    fetchBudget()
      .then((res) => {
        setBudgetState(res);
        if (res.monthlyBudgetTokens > 0) setLimit(res.monthlyBudgetTokens.toString());
      })
      .catch(() => setBudgetState(null));
  }, []);

  const onUpdate = async () => {
    const val = Number.parseInt(limit, 10);
    if (Number.isNaN(val) || val <= 0) return;
    try {
      const res = await setBudget(val);
      setBudgetState(res);
    } catch {
      // Ignore
    }
  };

  if (!budget) return <></>;

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface text-xs">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">Token Spending Budget</span>
          {budget.isOverBudget ? (
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
          Spent: {(budget.spentTokens / 1000000).toFixed(2)}M / Limit: {(budget.monthlyBudgetTokens / 1000000).toFixed(2)}M tokens
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="px-2 py-1 rounded-md border border-border bg-surface-elevated text-xs w-28"
          placeholder="5000000"
        />
        <button
          type="button"
          onClick={onUpdate}
          className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80"
        >
          Set Budget
        </button>
      </div>
    </div>
  );
}
