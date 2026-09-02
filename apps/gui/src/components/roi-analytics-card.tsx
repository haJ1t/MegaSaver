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

  const savedDollars = typeof roi.savedDollars === "number" ? roi.savedDollars.toFixed(2) : "0.00";
  const timeSavedHours =
    typeof roi.timeSavedHours === "number" ? roi.timeSavedHours.toFixed(1) : "0.0";
  const roiRatio = typeof roi.roiRatio === "number" ? roi.roiRatio.toFixed(1) : "0.0";
  const projectedAnnualSavings =
    typeof roi.projectedAnnualSavings === "number" ? roi.projectedAnnualSavings.toFixed(2) : "0.00";

  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-surface text-xs">
      <div className="grid grid-cols-4 gap-3">
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">Saved Dollars</span>
          <span className="text-lg font-semibold text-accent">${savedDollars}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">Time Saved</span>
          <span className="text-lg font-semibold text-text-primary">{timeSavedHours} hrs</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">ROI Ratio</span>
          <span className="text-lg font-semibold text-text-primary">{roiRatio}x</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">Est. Annual</span>
          <span className="text-lg font-semibold text-text-primary">${projectedAnnualSavings}</span>
        </div>
      </div>
      {roi.footnote ? (
        <span className="text-[10px] text-text-muted leading-tight" title={roi.footnote}>
          {roi.footnote} · ${roi.inputPricePerMTokUsd}/M captured {roi.capturedAt}
        </span>
      ) : null}
    </div>
  );
}
