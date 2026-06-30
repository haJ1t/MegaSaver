# @megasaver/skill-packs

## 1.1.0

### Minor Changes

- d811e38: Real skill-packs subsystem: loadPack (manifest validation, path-escape
  and symlink guards), filesystem discovery (workspace beats global),
  atomic workspace installer with skill-id conflict detection, and the
  `mega pack {install,list,remove,info}` CLI. Retires the
  not_implemented placeholder error code.
- 07bd0a7: Store path, GUI bridge store path, and skill-packs global packs root now
  use %LOCALAPPDATA%\megasaver on Windows (falling back to
  %USERPROFILE%\AppData\Local), and the env boundary reads
  HOME→USERPROFILE so the default location is correct on Windows. The
  win32 default fails loud (throws) when no base dir is resolvable rather
  than writing to a relative path. POSIX behavior is byte-identical. A new
  readStoreEnv() boundary centralizes the env read across CLI commands.

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.
