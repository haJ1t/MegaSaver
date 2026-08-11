import { z } from "zod";

export const auditionReportSchema = z
  .object({
    version: z.literal(1),
    fixtures: z.array(
      z.object({
        name: z.string(),
        rawBytes: z.number(),
        deliveredBytes: z.number(),
        chunks: z.number(),
        exitCode: z.number(),
      }),
    ),
    verdict: z.string(),
  })
  .passthrough();

export type AuditionReport = z.infer<typeof auditionReportSchema>;

export function buildAuditionReport(fixtures: AuditionReport["fixtures"]): AuditionReport {
  return {
    version: 1,
    fixtures,
    verdict:
      "On this fixture, delivery was smaller than raw. This is a byte counter, not a bill claim.",
  };
}

export function renderAuditionReport(report: AuditionReport): string {
  const lines = [`# Audition report v${report.version}`];
  for (const f of report.fixtures) {
    lines.push(
      `${f.name}: ${f.rawBytes} -> ${f.deliveredBytes} bytes, chunks=${f.chunks}, exit=${f.exitCode}`,
    );
  }
  lines.push(report.verdict);
  return lines.join("\n");
}
