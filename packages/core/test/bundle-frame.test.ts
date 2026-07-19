import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type BundleFrameConfig,
  parseBundle,
  serializeBundle,
  sha256Hex,
} from "../src/bundle-frame.js";

type ToyCode = "malformed" | "hash_mismatch" | "unsupported_version";

class ToyError extends Error {
  readonly code: ToyCode;

  constructor(code: ToyCode, message: string) {
    super(message);
    this.name = "ToyError";
    this.code = code;
  }
}

const toyManifestSchema = z
  .object({
    schemaVersion: z.literal("7"),
    note: z.string().min(1),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
type ToyManifest = z.infer<typeof toyManifestSchema>;

const toyPayloadSchema = z.object({ items: z.array(z.string()) }).strict();
type ToyPayload = z.infer<typeof toyPayloadSchema>;

const frame: BundleFrameConfig<ToyManifest, ToyPayload> = {
  schemaVersion: "7",
  manifestSchema: toyManifestSchema,
  payloadSchema: toyPayloadSchema,
  payloadShaOf: (manifest) => manifest.payloadSha256,
  makeError: (code, message) => new ToyError(code, message),
};

const payload: ToyPayload = { items: ["alpha", "beta"] };
const payloadRaw = JSON.stringify(payload);
const manifest: ToyManifest = {
  schemaVersion: "7",
  note: "toy",
  payloadSha256: sha256Hex(payloadRaw),
};
const text = serializeBundle(frame, { manifest, payload });

function codeOf(fn: () => unknown): ToyCode {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ToyError);
    return (error as ToyError).code;
  }
  return expect.unreachable() as never;
}

describe("sha256Hex", () => {
  it("hashes utf8 text to lowercase hex", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("serializeBundle", () => {
  it("writes manifest line + payload line with no trailing newline", () => {
    const idx = text.indexOf("\n");
    expect(idx).toBeGreaterThan(0);
    expect(text.endsWith("\n")).toBe(false);
    expect(JSON.parse(text.slice(0, idx))).toEqual(manifest);
    expect(text.slice(idx + 1)).toBe(payloadRaw);
  });

  it("rejects a manifest failing its schema", () => {
    expect(() =>
      serializeBundle(frame, { manifest: { ...manifest, note: "" }, payload }),
    ).toThrow();
  });

  it("rejects a manifest sha that does not cover the payload", () => {
    const stale = { ...manifest, payloadSha256: sha256Hex("stale payload bytes") };
    expect(codeOf(() => serializeBundle(frame, { manifest: stale, payload }))).toBe(
      "hash_mismatch",
    );
  });
});

describe("parseBundle", () => {
  it("roundtrips", () => {
    expect(parseBundle(frame, text)).toEqual({ manifest, payload });
  });

  it("tolerates one trailing newline", () => {
    expect(parseBundle(frame, `${text}\n`).payload.items).toEqual(["alpha", "beta"]);
    expect(parseBundle(frame, `${text}\r\n`).payload.items).toEqual(["alpha", "beta"]);
  });

  it("rejects missing newline via the frame error factory", () => {
    expect(codeOf(() => parseBundle(frame, "{}"))).toBe("malformed");
  });

  it("rejects non-JSON manifest", () => {
    expect(codeOf(() => parseBundle(frame, `not-json\n${payloadRaw}`))).toBe("malformed");
  });

  it("rejects null manifest", () => {
    expect(codeOf(() => parseBundle(frame, `null\n${payloadRaw}`))).toBe("malformed");
  });

  it("gates on schemaVersion before manifest schema", () => {
    const future = { ...manifest, schemaVersion: "8", extraFutureField: true };
    expect(codeOf(() => parseBundle(frame, `${JSON.stringify(future)}\n${payloadRaw}`))).toBe(
      "unsupported_version",
    );
  });

  it("rejects a manifest failing schema", () => {
    const bad = { ...manifest, payloadSha256: "zzz" };
    expect(codeOf(() => parseBundle(frame, `${JSON.stringify(bad)}\n${payloadRaw}`))).toBe(
      "malformed",
    );
  });

  it("rejects tampered payload with hash_mismatch", () => {
    expect(codeOf(() => parseBundle(frame, text.replace("alpha", "aXpha")))).toBe("hash_mismatch");
  });

  it("rejects payload JSON syntax errors", () => {
    const badPayload = "{not json";
    const m = { ...manifest, payloadSha256: sha256Hex(badPayload) };
    expect(codeOf(() => parseBundle(frame, `${JSON.stringify(m)}\n${badPayload}`))).toBe(
      "malformed",
    );
  });

  it("checks the hash before parsing payload JSON: bad JSON + wrong sha is hash_mismatch", () => {
    const badPayload = "{not json";
    expect(codeOf(() => parseBundle(frame, `${JSON.stringify(manifest)}\n${badPayload}`))).toBe(
      "hash_mismatch",
    );
  });

  it("rejects payload failing its schema", () => {
    const raw = JSON.stringify({ items: [1] });
    const m = { ...manifest, payloadSha256: sha256Hex(raw) };
    expect(codeOf(() => parseBundle(frame, `${JSON.stringify(m)}\n${raw}`))).toBe("malformed");
  });
});
