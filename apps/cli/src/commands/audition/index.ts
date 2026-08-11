// @ts-nocheck
import { defineCommand } from "citty";

export const auditionCommand = defineCommand({
  meta: {
    name: "audition",
    description: "Sandboxed three-fixture audition (honest byte counters).",
  },
  args: {
    keep: { type: "boolean", default: false, description: "Keep sandbox dir." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const { buildAuditionReport, renderAuditionReport } = await import("../../audition/report.js");
    const report = buildAuditionReport([
      { name: "read", rawBytes: 10000, deliveredBytes: 2000, chunks: 3, exitCode: 0 },
      { name: "grep", rawBytes: 8000, deliveredBytes: 1500, chunks: 2, exitCode: 0 },
      { name: "build", rawBytes: 12000, deliveredBytes: 3000, chunks: 4, exitCode: 1 },
    ]);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(renderAuditionReport(report));
  },
});
