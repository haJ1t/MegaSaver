---
"@megasaver/cli": patch
---

Harden the published license disclosure for the bundled-Pro tarball. The
`license` field is now `SEE LICENSE IN NOTICE` (the tarball inlines the
proprietary `@megasaver/pro-analytics`, so a bare `MIT` overclaimed the whole
package), and both the MIT `LICENSE` and the proprietary `PRO-LICENSE` now ship
in the tarball alongside `NOTICE` so every referenced license text is present.
