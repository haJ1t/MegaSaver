import { CacheDoctorCard } from "../components/cache-doctor-card.js";
import { ForgeLearningCard } from "../components/forge-learning-card.js";
import { RoiAnalyticsCard } from "../components/roi-analytics-card.js";
import { TokenBudgetCard } from "../components/token-budget-card.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";
import { DaemonStatusPanel } from "./cockpit/daemon-status.js";
import { HookConnection } from "./cockpit/hook-connection.js";
import { ProxyActivation } from "./cockpit/proxy-activation.js";
import { SaverModeActivation } from "./cockpit/saver-mode-activation.js";

function Step({ n, children }: { n: number; children: React.ReactNode }): JSX.Element {
  return (
    <section className="flex gap-4 px-5 py-4 rounded-xl border border-border bg-surface">
      <span
        aria-hidden="true"
        className="grid place-items-center shrink-0 w-6 h-6 rounded-full bg-surface-elevated font-mono text-xs text-text-secondary"
      >
        {n}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </section>
  );
}

export function TokenSaverPage({
  options,
  activeKey,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
}): JSX.Element {
  const key = activeKey ?? options[0]?.key ?? null;
  const active = options.find((o) => o.key === key) ?? null;
  return (
    <div className="max-w-[900px] flex flex-col gap-3.5 px-5 py-7">
      <div>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Token saver</h1>
        <p className="mt-1 mb-0 text-text-secondary">
          Three switches stand between you and a smaller bill.
          {active ? (
            <>
              {" "}
              Mode applies to <span className="font-mono text-sm">{active.label}</span>.
            </>
          ) : null}
        </p>
      </div>

      <RoiAnalyticsCard />
      <TokenBudgetCard />
      <CacheDoctorCard />
      <ForgeLearningCard />

      <Step n={1}>
        <HookConnection />
      </Step>
      <Step n={2}>
        <ProxyActivation />
      </Step>
      <Step n={3}>
        {active === null ? (
          <p className="text-sm text-text-muted">Select a workspace to configure saver mode.</p>
        ) : (
          <SaverModeActivation dir={active.rep.dir} id={active.rep.id} />
        )}
      </Step>
      <section className="px-5 py-4 rounded-xl border border-border bg-surface">
        <DaemonStatusPanel />
      </section>
    </div>
  );
}
