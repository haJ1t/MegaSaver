---
"@megasaver/cli": minor
"@megasaver/gui": minor
"@megasaver/skill-packs": minor
---

Store path, GUI bridge store path, and skill-packs global packs root now
use %LOCALAPPDATA%\megasaver on Windows (falling back to
%USERPROFILE%\AppData\Local), and the env boundary reads
HOME→USERPROFILE so the default location is correct on Windows. The
win32 default fails loud (throws) when no base dir is resolvable rather
than writing to a relative path. POSIX behavior is byte-identical. A new
readStoreEnv() boundary centralizes the env read across CLI commands.
