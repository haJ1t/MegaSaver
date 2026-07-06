import { afterEach, describe, expect, it, vi } from "vitest";
import { copyBlob, downloadBlob, svgToPngBlob } from "../../src/lib/card-export.js";

const PNG = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

// jsdom has no real canvas/Image raster path, so stub the browser primitives the
// export walks through: Image (fires onload), canvas.getContext + toBlob.
function stubRasterPipeline(): void {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 0;
    height = 0;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);

  const ctx = { drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => cb(PNG));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("svgToPngBlob", () => {
  it("resolves a PNG blob rasterized from the svg string", async () => {
    stubRasterPipeline();
    const blob = await svgToPngBlob("<svg></svg>");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
  });

  it("rejects when the image fails to decode", async () => {
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BrokenImage);
    await expect(svgToPngBlob("<svg></svg>")).rejects.toThrow();
  });
});

describe("downloadBlob", () => {
  it("clicks an anchor pointing at the blob object URL", () => {
    const url = "blob:fake";
    const createObjectURL = vi.fn(() => url);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadBlob(PNG, "megasaver-savings.png");

    expect(createObjectURL).toHaveBeenCalledWith(PNG);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
  });
});

describe("copyBlob", () => {
  it("writes a ClipboardItem when the clipboard API is available", async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(public items: Record<string, Blob>) {}
      },
    );
    vi.stubGlobal("navigator", { clipboard: { write } });

    const ok = await copyBlob(PNG);
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("returns false when the clipboard API is missing (no throw)", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("ClipboardItem", undefined);
    const ok = await copyBlob(PNG);
    expect(ok).toBe(false);
  });
});
