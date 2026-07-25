import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileGlob } from "../src/secret-paths.js";

// The pre-fix implementation, frozen verbatim as the equivalence oracle. It is
// NOT imported from src — it no longer exists there. Keeping the old body here
// is what makes "the LOCKED §9a denylist still decides every path the same way"
// a checkable claim rather than an assertion.
function legacyCompileGlob(glob: string): RegExp {
  let body = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          body += "(?:.*/)?";
          i += 2;
        } else {
          body += ".*";
          i += 1;
        }
      } else {
        body += "[^/]*";
      }
    } else if (char === "?") {
      body += "[^/]";
    } else if (char === ".") {
      body += "\\.";
    } else {
      body += char;
    }
  }
  return new RegExp(`^${body}$`, "i");
}

const DENYLIST_GLOBS = [
  "**/.env",
  "**/.env.*",
  "**/.ssh/**",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.gcp/**",
  "**/.azure/**",
  "**/private_keys/**",
  "**/secrets/**",
  "**/id_rsa",
  "**/id_ed25519",
  "**/*.pem",
  "**/*.key",
  "**/credentials.json",
  "**/service-account*.json",
] as const;

const PATHS = [
  ".env",
  "a/.env",
  "a/b/.env",
  "a/.env.local",
  ".env.local",
  "x.env",
  ".envx",
  ".ssh/id_rsa",
  "home/u/.ssh/known_hosts",
  "home/u/.ssh/x/y/z",
  ".ssh",
  ".ssh/",
  "home/.aws/credentials",
  "home/.aws/config",
  "home/.aws/configx",
  "home/.gcp/keys/k.json",
  "home/.azure/t.json",
  "vault/private_keys/s.key",
  "app/secrets/db.txt",
  "secrets/db.txt",
  "home/.ssh/id_rsa",
  "id_rsa",
  "id_ed25519",
  "certs/server.pem",
  "server.pem",
  "certs/server.key",
  "config/credentials.json",
  "credentials.json",
  "config/service-account-prod.json",
  "service-account.json",
  "SERVER.PEM",
  "Home/.SSH/id_rsa",
  "src/index.ts",
  "README.md",
  "",
  "/",
  "a//b",
] as const;

describe("compileGlob — LOCKED §9a denylist verdicts are unchanged", () => {
  for (const glob of DENYLIST_GLOBS) {
    it(`${glob} decides every fixture path identically`, () => {
      const legacy = legacyCompileGlob(glob);
      const matcher = compileGlob(glob);
      for (const path of PATHS) {
        expect({ path, hit: matcher.test(path) }).toEqual({
          path,
          hit: legacy.test(path),
        });
      }
    });
  }
});

// Segment corpus deliberately seeded with the real secret basenames. A path
// built from a generic alphabet essentially never matches a denylist glob —
// measured 0/20,000 — which would make the property vacuous: it would only ever
// compare false===false and could not fail. Joining these segments lands 5.0%
// genuine matches instead.
const SEGMENTS = [
  "a",
  "b",
  "home",
  ".env",
  ".env.local",
  ".ssh",
  "id_rsa",
  "id_ed25519",
  ".aws",
  "credentials",
  "config",
  ".gcp",
  ".azure",
  "private_keys",
  "secrets",
  "server.pem",
  "server.key",
  "credentials.json",
  "service-account-prod.json",
  "x.txt",
  "",
] as const;

// Exhaustive beats random for the arm-adjacency bugs that matter here: an
// off-by-one in the `**/` `seen` ordering or the `*` `active` clear only shows
// up in specific short arrangements of wildcards and separators, which a
// generator may or may not draw. This enumerates ALL of them up to these
// lengths — every `**/`, `**`, `*`, `?`, literal and separator adjacency.
function enumerate(alphabet: readonly string[], maxLength: number): string[] {
  const out = [""];
  let level = [""];
  for (let length = 1; length <= maxLength; length += 1) {
    const nextLevel: string[] = [];
    for (const prefix of level) {
      for (const ch of alphabet) {
        nextLevel.push(prefix + ch);
        out.push(prefix + ch);
      }
    }
    level = nextLevel;
  }
  return out;
}

describe("compileGlob — exhaustive equivalence over short glob/path space", () => {
  it("agrees with the frozen regex on every glob<=6 x path<=7", () => {
    const globs = enumerate(["a", "/", "*", "?"], 6);
    const paths = enumerate(["a", "/"], 7);
    let compared = 0;
    let legacyHits = 0;

    for (const glob of globs) {
      const legacy = legacyCompileGlob(glob);
      const matcher = compileGlob(glob);
      for (const path of paths) {
        const want = legacy.test(path);
        if (want) legacyHits += 1;
        compared += 1;
        if (matcher.test(path) !== want) {
          throw new Error(
            `divergence: glob=${JSON.stringify(glob)} path=${JSON.stringify(path)} legacy=${want}`,
          );
        }
      }
    }

    expect(compared).toBeGreaterThan(1_000_000);
    // Non-vacuity: if this floor ever fails the space stopped producing
    // matches and the whole sweep degenerated to comparing false===false.
    expect(legacyHits).toBeGreaterThan(compared * 0.02);
  });
});

// Case folding changed carrier: the regex `i` flag used Canonicalize (which
// refuses any non-ASCII -> ASCII mapping), the matcher uses toLowerCase(). They
// are identical on ASCII, so every LOCKED §9a glob — all ASCII — is unaffected.
// Off ASCII they differ, and the DIRECTION is what matters for a denylist.
describe("compileGlob — non-ASCII case-folding divergence is bounded", () => {
  // Tightening: the matcher denies paths the regex let through. Safe direction.
  const tightens: ReadonlyArray<readonly [string, string, string]> = [
    ["k", "K", "KELVIN SIGN"],
    ["ß", "ẞ", "capital sharp s"],
    ["å", "Å", "ANGSTROM SIGN"],
  ];

  for (const [glob, path, label] of tightens) {
    it(`matches more than the regex did — ${label}`, () => {
      expect(legacyCompileGlob(glob).test(path)).toBe(false);
      expect(compileGlob(glob).test(path)).toBe(true);
    });
  }

  // Weakening direction. A security review scanning every code point in
  // U+0000–U+2FFFF found 23 such families, not one — the pairs below are a
  // sample. All share a shape: two non-ASCII code points that share an
  // uppercase form (so Canonicalize unified them) but not a lowercase form.
  // Reaching any of them needs a NON-ASCII glob, which is why the LOCKED
  // denylist is untouched.
  const weakens: ReadonlyArray<readonly [string, string, string]> = [
    ["ς", "σ", "Greek final vs medial sigma"],
    ["µ", "μ", "MICRO SIGN vs Greek mu"],
    ["ϐ", "β", "Greek beta symbol"],
    ["ϑ", "θ", "Greek theta symbol"],
    ["ẛ", "ṡ", "long s with dot above"],
  ];

  for (const [glob, path, label] of weakens) {
    it(`no longer unifies ${label}`, () => {
      expect(legacyCompileGlob(glob).test(path)).toBe(true);
      expect(compileGlob(glob).test(path)).toBe(false);
    });
  }

  // U+0130 is the one code point in that range whose toLowerCase() expands to
  // TWO code units, so a folded path is longer than the original and `?` — a
  // one-character token — no longer spans it. Needs no non-ASCII glob at all,
  // but also no denylist glob contains `?`.
  it("? no longer spans a code point that case-folds to two units", () => {
    expect(legacyCompileGlob("?.pem").test("İ.pem")).toBe(true);
    expect(compileGlob("?.pem").test("İ.pem")).toBe(false);
    expect(DENYLIST_GLOBS.some((glob) => glob.includes("?"))).toBe(false);
  });

  it("every LOCKED denylist glob is pure ASCII, so none of this reaches them", () => {
    for (const glob of DENYLIST_GLOBS) {
      expect([...glob].every((ch) => ch >= " " && ch <= "~")).toBe(true);
    }
  });
});

describe("compileGlob — property equivalence on metachar-free input", () => {
  // Restricted to the alphabet where the two implementations are SUPPOSED to
  // agree. Outside it they diverge on purpose: that divergence is the fix, and
  // it is pinned by glob-redos.test.ts instead.
  const wideGlob = fc.stringOf(fc.constantFrom(..."ab.-_/*?".split("")), { maxLength: 12 });
  const widePath = fc.stringOf(fc.constantFrom(..."ab.-_/".split("")), { maxLength: 20 });

  // A three-character alphabet at short lengths is what makes random globs and
  // random paths actually collide (7.4% match rate vs 1.2% on the wide one).
  const denseGlob = fc.stringOf(fc.constantFrom(..."ab/*?".split("")), { maxLength: 6 });
  const densePath = fc.stringOf(fc.constantFrom(..."ab/".split("")), { maxLength: 6 });

  it("agrees with the frozen regex on wide-alphabet globs and paths", () => {
    fc.assert(
      fc.property(wideGlob, widePath, (glob, path) => {
        expect(compileGlob(glob).test(path)).toBe(legacyCompileGlob(glob).test(path));
      }),
      { numRuns: 20_000 },
    );
  });

  it("agrees on a dense alphabet where random globs and paths collide", () => {
    fc.assert(
      fc.property(denseGlob, densePath, (glob, path) => {
        expect(compileGlob(glob).test(path)).toBe(legacyCompileGlob(glob).test(path));
      }),
      { numRuns: 20_000 },
    );
  });

  it("agrees on segment-corpus paths against each LOCKED denylist glob", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DENYLIST_GLOBS),
        fc.array(fc.constantFrom(...SEGMENTS), { minLength: 1, maxLength: 4 }),
        (glob, segments) => {
          const path = segments.join("/");
          expect(compileGlob(glob).test(path)).toBe(legacyCompileGlob(glob).test(path));
        },
      ),
      { numRuns: 20_000 },
    );
  });
});
