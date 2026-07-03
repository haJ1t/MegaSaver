import { describe, expect, it } from "vitest";
import {
  type FamilyFsAdapter,
  canonicalFamilyPath,
  familyKeyFromPath,
} from "../src/family-identity.js";

// A fake fs adapter: realpath maps declared aliases; caseMode per-prefix.
function fakeFs(opts: {
  realpaths?: Record<string, string>;
  caseModes?: Array<[string, "sensitive" | "insensitive" | "unknown"]>;
}): FamilyFsAdapter {
  return {
    realpathNative: (p) => opts.realpaths?.[p] ?? p,
    caseMode: (p) => {
      for (const [prefix, mode] of opts.caseModes ?? []) {
        if (p.startsWith(prefix)) return mode;
      }
      return "unknown";
    },
  };
}

describe("canonicalFamilyPath", () => {
  it("collapses /tmp and /private/tmp aliases via realpath.native", () => {
    const fs = fakeFs({
      realpaths: { "/tmp/repo/.git": "/private/tmp/repo/.git" },
      caseModes: [["/private", "sensitive"]],
    });
    const a = canonicalFamilyPath("/tmp/repo/.git", "darwin", fs);
    const b = canonicalFamilyPath("/private/tmp/repo/.git", "darwin", fs);
    expect(a.canonicalPath).toBe("/private/tmp/repo/.git");
    expect(a.canonicalPath).toBe(b.canonicalPath);
  });

  it("lowercases only on an insensitive volume (incl. Windows drive letter)", () => {
    const insens = fakeFs({ caseModes: [["C:", "insensitive"]] });
    const upper = canonicalFamilyPath("C:/Repo/.git", "win32", insens);
    const lower = canonicalFamilyPath("c:/repo/.git", "win32", insens);
    expect(upper.canonicalPath).toBe("c:/repo/.git");
    expect(upper.canonicalPath).toBe(lower.canonicalPath);
    expect(upper.caseMode).toBe("insensitive");
    expect(upper.diagnostic).toBeNull();
  });

  it("preserves casing on a sensitive volume (distinct dirs stay distinct)", () => {
    const sens = fakeFs({ caseModes: [["/", "sensitive"]] });
    expect(canonicalFamilyPath("/Repo/.git", "linux", sens).canonicalPath).not.toBe(
      canonicalFamilyPath("/repo/.git", "linux", sens).canonicalPath,
    );
  });

  it("preserves casing and surfaces case_mode_unknown on an unknown volume", () => {
    const unk = fakeFs({ caseModes: [["/", "unknown"]] });
    const r = canonicalFamilyPath("/Repo/.git", "linux", unk);
    expect(r.canonicalPath).toBe("/Repo/.git");
    expect(r.diagnostic).toBe("case_mode_unknown");
  });

  it("normalizes composed vs decomposed unicode to the same NFC path", () => {
    const fs = fakeFs({ caseModes: [["/", "sensitive"]] });
    const composed = "/x/\u00e9/.git"; // \u00e9 = precomposed
    const decomposed = "/x/e\u0301/.git"; // e + U+0301 combining acute
    expect(composed).not.toBe(decomposed); // genuinely different input bytes
    expect(canonicalFamilyPath(composed, "linux", fs).canonicalPath).toBe(
      canonicalFamilyPath(decomposed, "linux", fs).canonicalPath,
    );
  });

  it("converts backslashes to forward slashes", () => {
    const fs = fakeFs({ caseModes: [["C:", "sensitive"]] });
    expect(canonicalFamilyPath("C:\\repo\\.git", "win32", fs).canonicalPath).toBe("C:/repo/.git");
  });
});

describe("familyKeyFromPath", () => {
  const fs = fakeFs({ caseModes: [["/", "sensitive"]] });

  it("produces a gf1_ + 43 base64url-char key and a 64-hex digest", () => {
    const { canonicalPath, caseMode } = canonicalFamilyPath("/repo/.git", "linux", fs);
    const out = familyKeyFromPath("linux", caseMode, canonicalPath);
    expect(out.key).toMatch(/^gf1_[A-Za-z0-9_-]{43}$/);
    expect(out.digestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(out.identityPath).toBe("/repo/.git");
  });

  it("is deterministic and distinct per path", () => {
    const k1 = familyKeyFromPath("linux", "sensitive", "/a/.git").key;
    const k1again = familyKeyFromPath("linux", "sensitive", "/a/.git").key;
    const k2 = familyKeyFromPath("linux", "sensitive", "/b/.git").key;
    expect(k1).toBe(k1again);
    expect(k1).not.toBe(k2);
  });

  it("separates the domain: platform and caseMode change the key", () => {
    const base = familyKeyFromPath("linux", "sensitive", "/a/.git").key;
    expect(familyKeyFromPath("darwin", "sensitive", "/a/.git").key).not.toBe(base);
    expect(familyKeyFromPath("linux", "insensitive", "/a/.git").key).not.toBe(base);
  });
});
