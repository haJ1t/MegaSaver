import type { KeyObject } from "node:crypto";
import { formatDollarsSaved } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  PRO_ANALYTICS_URL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./savings/shared.js";

// roi-specific upsell: the shared PRO_ANALYTICS_UPSELL says "historical savings
// analytics", which would misname this feature. Same activation mechanics.
export const ROI_UPSELL = `ROI reporting is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Boundary parse (§8): the renderer divides by the price, so reject a
// non-finite or non-positive amount here. `$` prefix optional; both dollars.
export function parsePrice(raw: string): number | null {
  const amount = Number(raw.startsWith("$") ? raw.slice(1) : raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export type RunRoiInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  price?: string;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runRoi(input: RunRoiInput): Promise<0 | 1> {
  // The entitlement gate runs FIRST. On the not-entitled path we print an honest
  // upsell and return 0 without importing pro-analytics or reading any events —
  // the Pro compute must never half-run for a free user.
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(ROI_UPSELL);
    return 0;
  }

  let priceOverride: number | null = null;
  if (input.price !== undefined) {
    priceOverride = parsePrice(input.price);
    if (priceOverride === null) {
      input.stderr(
        `Invalid --price ${input.price}: expected a positive dollar amount (e.g. 7.99 or $7.99).`,
      );
      return 1;
    }
  }

  const { PRO_PRICE_USD_PER_MONTH, computeRoi } = await import("@megasaver/pro-analytics");
  const { events } = await input.readAllEvents();
  const report = computeRoi(events, {
    now: input.now(),
    priceUsd: priceOverride ?? PRO_PRICE_USD_PER_MONTH,
  });

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (report.savedSoFar.bytes === 0) {
    input.stdout("No savings recorded this month yet.");
    return 0;
  }

  // The price is an exact known amount, not an estimate — render it with fixed
  // cents instead of the floor-for-honesty savings formatter.
  const price = `$${report.priceUsd.toFixed(2)}`;
  const saved = formatDollarsSaved(report.savedSoFar.dollars);
  const proj = formatDollarsSaved(report.projectedEnd.dollars);
  // Floor displayed multiples (like formatDollarsSaved): rounding roiSoFar in
  // [0.95, 1) up to "1.0×" would contradict the "hasn't paid for itself" prose.
  const fmtRoi = (r: number) => `${(Math.floor(r * 10) / 10).toFixed(1)}×`;
  const roiSo = fmtRoi(report.roiSoFar);
  const roiProj = fmtRoi(report.roiProjected);
  const sessions = report.contextWindowsReclaimed.toFixed(1);
  const daysLeft = Math.round(report.daysLeft);

  const headline = report.paidForItself
    ? `Pro ${price}/mo → saved ${saved} this month (est.) = ${roiSo} · on pace for ${roiProj} by month end (est.) · +${sessions} sessions' worth of context`
    : `ROI ${roiSo} so far — hasn't paid for itself yet · on pace for ${roiProj} by month end (est.) · ${daysLeft} days left`;
  input.stdout(headline);
  input.stdout("");
  input.stdout(`price          ${price}/mo`);
  input.stdout(`saved so far   ${saved} (${report.savedSoFar.tokens} tokens)`);
  input.stdout(`roi so far     ${roiSo}`);
  input.stdout(`projected end  ${proj} (est.) = ${roiProj}`);
  input.stdout(`sessions       +${sessions} sessions' worth of context`);
  input.stdout(`days left      ${daysLeft}`);
  return 0;
}

export const roiCommand = defineCommand({
  meta: {
    name: "roi",
    description: "Is Pro worth its price? Monthly savings vs subscription (Mega Saver Pro).",
  },
  args: {
    price: {
      type: "string",
      description: "Monthly price to compare against: <n> or $<n> (default: $7.99).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runRoi({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      ...(typeof args.price === "string" ? { price: args.price } : {}),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
