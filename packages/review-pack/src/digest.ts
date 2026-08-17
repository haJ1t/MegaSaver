import { redact } from "@megasaver/policy";
import type { ReviewPack } from "./pack.js";

export function renderDigest(pack: ReviewPack): string {
  const lines: string[] = [];
  lines.push(`review pack ${pack.packId}  ${pack.range.label}`);
  lines.push(
    `head: ${pack.range.headSha.slice(0, 8)} | base: ${pack.range.baseSha.slice(0, 8)}`,
  );
  lines.push("");

  if (pack.claims.claims.length > 0) {
    lines.push("claims:");
    for (const c of pack.claims.claims) {
      lines.push(`  ${c.sha.slice(0, 8)} ${c.subject}`);
    }
    lines.push("");
  }

  lines.push("receipts:");
  if (pack.claims.receipts.length === 0) {
    lines.push("  (no test receipts recorded)");
  } else {
    for (const r of pack.claims.receipts) {
      const exitStr =
        r.exitCode === undefined
          ? "receipt without exit code"
          : r.exitCode === 0
            ? "exit 0"
            : `exit ${r.exitCode}`;
      lines.push(`  [${r.scope}] ${exitStr} — ${r.command}`);
    }
  }
  lines.push("");

  if (pack.claims.gaps.length > 0) {
    lines.push(`gaps: ${pack.claims.gaps.join(", ")}`);
    lines.push("");
  }

  lines.push("files touched:");
  for (const f of pack.files) {
    const diffChunks =
      f.diffChunkIds.length > 0
        ? `diff: ${f.diffChunkIds.join(",")}`
        : "no diff chunks";
    const ctxChunks =
      f.contextChunkIds.length > 0
        ? `context: ${f.contextChunkIds.join(",")}`
        : "no context chunks";
    lines.push(`  ${f.status} ${f.path} (${diffChunks} | ${ctxChunks})`);
  }
  lines.push("");

  lines.push("chunk sets:");
  lines.push(`  diff:     ${pack.chunkSets.diff}`);
  lines.push(`  context:  ${pack.chunkSets.context}`);
  lines.push(`  manifest: ${pack.chunkSets.manifest}`);
  lines.push("");
  lines.push(`expand: mega output chunk "${pack.chunkSets.diff}" "0"`);

  const fullText = lines.join("\n");
  return redact(fullText).redacted;
}
