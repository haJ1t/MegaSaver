const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

// Rasterize the SVG string to a PNG blob using only the browser: the SVG becomes
// a data-URL image, drawn onto a canvas, read back as PNG. Zero dependency — the
// browser does SVG->PNG for free.
export function svgToPngBlob(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CARD_WIDTH;
      canvas.height = CARD_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, CARD_WIDTH, CARD_HEIGHT);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas produced no PNG blob"));
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Failed to decode the card SVG"));
    // The real card SVG carries non-Latin-1 glyphs (≈, U+2248), so btoa() would
    // throw InvalidCharacterError. encodeURIComponent yields a UTF-8-safe
    // data-URL directly — no base64, and no fetch the CSP might block.
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Best-effort clipboard image copy. The API is guarded because Firefox and
// non-secure contexts lack ClipboardItem / clipboard.write — a false return
// lets the caller hide the action instead of throwing.
export async function copyBlob(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
