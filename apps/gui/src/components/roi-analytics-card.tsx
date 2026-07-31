import { useEffect, useState } from "react";
import { type RoiResponse, fetchRoi } from "../lib/claude-sessions-client.js";

export function RoiAnalyticsCard(): JSX.Element {
  const [roi, setRoi] = useState<RoiResponse | null>(null);

  useEffect(() => {
    fetchRoi()
      .then((res) => setRoi(res))
      .catch(() => setRoi(null));
  }, []);

  if (!roi) return <></>;

  return (
    <div className="grid grid-cols-4 gap-3 p-4 rounded-xl border border-border bg-surface text-xs">
      <div className="flex flex-col">
        <span className="text-[11px] text-text-muted">Saved Dollars</span>
        <span className="text-lg font-semibold text-accent">${roi.savedDollars}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-[11px] text-text-muted">Time Saved</span>
        <span className="text-lg font-semibold text-text-primary">{roi.timeSavedHours} hrs</span>
      </div>
      <div className="flex flex-col">
        <span className="text-[11px] text-text-muted">ROI Ratio</span>
        <span className="text-lg font-semibold text-text-primary">{roi.roiRatio}x</span>
      </div>
      <div className="flex flex-col">
        <span className="text-[11px] text-text-muted">Est. Annual</span>
        <span className="text-lg font-semibold text-text-primary">
          ${roi.projectedAnnualSavings}
        </span>
      </div>
    </div>
  );
}
