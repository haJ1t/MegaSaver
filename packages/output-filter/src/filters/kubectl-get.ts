const HEALTHY = new Set(["Running", "Completed", "Succeeded"]);
const MAX_PER_STATUS = 5;

// Anomalies are the whole point of reading `kubectl get`: every non-healthy
// or restarted row is kept; only zero-restart healthy rows fold past the cap.
export function compressKubectlGet(text: string): string {
  const lines = text.split("\n");
  const trailing = text.endsWith("\n");
  if (lines.at(-1) === "") lines.pop();
  const header = lines[0] ?? "";
  const cols = header.split(/\s{2,}/);
  const statusIdx = cols.indexOf("STATUS");
  if (statusIdx < 0) return text;
  const restartsIdx = cols.indexOf("RESTARTS");
  const out: string[] = [header];
  const kept = new Map<string, number>();
  const folded = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const parts = line.split(/\s{2,}/);
    const status = parts[statusIdx] ?? "";
    const restarts = restartsIdx >= 0 ? (parts[restartsIdx] ?? "0") : "0";
    const healthy = HEALTHY.has(status) && /^0(\s|$)/.test(restarts);
    if (!healthy) {
      out.push(line);
      continue;
    }
    const n = kept.get(status) ?? 0;
    if (n < MAX_PER_STATUS) {
      kept.set(status, n + 1);
      out.push(line);
      continue;
    }
    folded.set(status, (folded.get(status) ?? 0) + 1);
  }
  for (const [status, n] of folded) out.push(`… [${n} more ${status}]`);
  return out.join("\n") + (trailing ? "\n" : "");
}
