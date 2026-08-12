import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const DISCLOSURE_DIR = "disclosure";

export const disclosureReceiptSchema = z
  .object({
    sessionId: z.string().min(1),
    generatedAt: z.string().min(1),
    claimed: z.array(z.string()),
    observed: z.array(z.string()),
    undisclosed: z.array(z.string()),
    phantom: z.array(z.string()),
    droppedCandidates: z.number().int().nonnegative(),
    inputBytes: z.number().int().nonnegative(),
  })
  .strict();

export type DisclosureReceipt = z.infer<typeof disclosureReceiptSchema>;

export function disclosureReceiptPath(storeRoot: string, sessionId: string): string {
  return join(storeRoot, DISCLOSURE_DIR, `${sessionId}.json`);
}

export function writeDisclosureReceipt(storeRoot: string, receipt: DisclosureReceipt): void {
  const path = disclosureReceiptPath(storeRoot, receipt.sessionId);
  mkdirSync(join(storeRoot, DISCLOSURE_DIR), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function readDisclosureReceipt(
  storeRoot: string,
  sessionId: string,
): DisclosureReceipt | null {
  try {
    const raw = readFileSync(disclosureReceiptPath(storeRoot, sessionId), "utf8");
    const parsed = disclosureReceiptSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
