// Glob matching WITHOUT a regex. compileGlob used to build a RegExp from
// untrusted glob text, which made chained wildcards backtrack exponentially
// (`*a`x5 against a 255-character path: 58,529 ms) and passed regex
// metacharacters through unescaped, so a zero-wildcard glob `(a+)+b` was itself
// a ReDoS. Matching here is an NFA simulation: a boolean reachability frontier
// advanced once per token, so there is no backtracking to blow up —
// O(tokens x path length), always.
// See docs/superpowers/specs/2026-07-25-glob-compile-redos-fix-design.md.

export type PathMatcher = { test(path: string): boolean };

type Token =
  | { readonly kind: "literal"; readonly ch: string }
  | { readonly kind: "any" }
  | { readonly kind: "star" }
  | { readonly kind: "globstar" }
  | { readonly kind: "globstarSlash" };

// Token boundaries mirror the previous regex translation exactly: `**/` is one
// token consuming three characters, a bare `**` consumes two, `*` and `?` one.
// EVERY other character — including every regex metacharacter — is a literal.
function tokenize(glob: string): readonly Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] as string;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          tokens.push({ kind: "globstarSlash" });
          i += 2;
        } else {
          tokens.push({ kind: "globstar" });
          i += 1;
        }
      } else {
        tokens.push({ kind: "star" });
      }
    } else if (char === "?") {
      tokens.push({ kind: "any" });
    } else {
      tokens.push({ kind: "literal", ch: char });
    }
  }
  return tokens;
}

function matches(tokens: readonly Token[], path: string): boolean {
  const n = path.length;
  let cur = new Uint8Array(n + 1);
  let next = new Uint8Array(n + 1);
  cur[0] = 1;

  for (const token of tokens) {
    next.fill(0);
    let live = false;

    if (token.kind === "literal" || token.kind === "any") {
      for (let i = 0; i < n; i += 1) {
        if (cur[i] === 0) continue;
        const ch = path[i] as string;
        if (token.kind === "literal" ? ch === token.ch : ch !== "/") {
          next[i + 1] = 1;
          live = true;
        }
      }
    } else if (token.kind === "star" || token.kind === "globstar") {
      // A run reachable from any live start. `star` cannot cross a separator,
      // so its run clears at each `/`; `globstar` never clears.
      let active = false;
      for (let i = 0; i <= n; i += 1) {
        if (cur[i] === 1) active = true;
        if (active) {
          next[i] = 1;
          live = true;
        }
        if (token.kind === "star" && i < n && path[i] === "/") active = false;
      }
    } else {
      // `**/` — zero or more COMPLETE leading segments: either empty, or any
      // run from a live start that ends on a separator.
      let seen = false;
      for (let i = 0; i <= n; i += 1) {
        if (cur[i] === 1) {
          next[i] = 1;
          live = true;
        }
        if (seen && i > 0 && path[i - 1] === "/") {
          next[i] = 1;
          live = true;
        }
        if (cur[i] === 1) seen = true;
      }
    }

    if (!live) return false;
    const swap = cur;
    cur = next;
    next = swap;
  }

  return cur[n] === 1;
}

// Case-insensitive, matching the `i` flag the compiled regex carried. The glob
// folds once at compile time, the path on each call.
export function compileGlobMatcher(glob: string): PathMatcher {
  const tokens = tokenize(glob.toLowerCase());
  return { test: (path: string): boolean => matches(tokens, path.toLowerCase()) };
}
