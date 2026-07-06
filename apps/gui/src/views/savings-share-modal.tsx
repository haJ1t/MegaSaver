import {
  computeSavingsHeadline,
  formatDollarsSaved,
  renderSavingsCardSvg,
} from "@megasaver/stats/headline";
import { useCallback, useMemo, useState } from "react";
import { copyBlob, downloadBlob, svgToPngBlob } from "../lib/card-export.js";
import type { AllWorkspaceTokenSaverTotals } from "../lib/claude-sessions-client.js";

const PNG_NAME = "megasaver-savings.png";

function tweetText(dollars: string): string {
  // Honest: the (est.) qualifier rides along, same discipline as the card.
  return `Saved ≈${dollars} of tokens with Mega Saver — less tokens, more signal. (est.)`;
}

export function SavingsShareModal({
  totals,
  windowLabel,
  onClose,
  openUrl = (url) => window.open(url, "_blank", "noopener,noreferrer"),
}: {
  totals: AllWorkspaceTokenSaverTotals;
  windowLabel: string;
  onClose: () => void;
  openUrl?: (url: string) => void;
}): JSX.Element {
  const headline = useMemo(() => computeSavingsHeadline(totals), [totals]);
  const svg = useMemo(
    () => renderSavingsCardSvg(headline, { windowLabel }),
    [headline, windowLabel],
  );
  const dollars = formatDollarsSaved(headline.dollarsSaved);
  const [copied, setCopied] = useState(false);

  const onDownload = useCallback(async () => {
    const blob = await svgToPngBlob(svg);
    downloadBlob(blob, PNG_NAME);
  }, [svg]);

  const onCopy = useCallback(async () => {
    const blob = await svgToPngBlob(svg);
    setCopied(await copyBlob(blob));
  }, [svg]);

  const onShareX = useCallback(() => {
    openUrl(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText(dollars))}`);
  }, [openUrl, dollars]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: native <dialog> needs showModal()/focus-trap plumbing jsdom lacks; a controlled role="dialog" overlay is the React-idiomatic form here.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share your savings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        aria-label="Dismiss"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Share your savings</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* renderSavingsCardSvg escapes all interpolated text, so the string is
            safe to inline; it is the product's own deterministic markup. */}
        <div
          className="overflow-hidden rounded-lg border border-border [&>svg]:h-auto [&>svg]:w-full"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: card SVG is escaped by renderSavingsCardSvg
          dangerouslySetInnerHTML={{ __html: svg }}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDownload}
            className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm cursor-pointer"
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm cursor-pointer"
          >
            {copied ? "Copied" : "Copy image"}
          </button>
          <button
            type="button"
            onClick={onShareX}
            className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm cursor-pointer"
          >
            Share on X
          </button>
        </div>

        <p className="mt-3 text-xs text-text-muted">
          X can't auto-attach the image — download the card, then attach it to your post.
        </p>
      </div>
    </div>
  );
}
