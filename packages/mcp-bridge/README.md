# @megasaver/mcp-bridge

MCP server exposing the Mega Saver tools (read-file, run-command,
fetch-chunk, recall) over stdio.

## Tool Naming Mode (Proxy Mode v1.2)

The bridge exposes exactly **one** name per underlying tool — never
both the `proxy_*` and `mega_*` set at once — so a token-saving
product never wastes context on duplicate tool schemas.

```
MEGASAVER_TOOL_NAMING=proxy|legacy   # default: proxy
```

- **proxy** (default): `tools/list` exposes the public Proxy Mode
  names for the renamed tools.
- **legacy**: `tools/list` exposes the original `mega_*` names. Use
  this for existing connector installs pinned to the old names.

Both modes call the same underlying implementation — switching modes
changes only the exposed name, never behavior.

### Name mapping (§5.3)

| proxy mode          | legacy mode        |
| ------------------- | ------------------ |
| `proxy_read_file`   | `mega_read_file`   |
| `proxy_run_command` | `mega_run_command` |
| `proxy_expand_chunk`| `mega_fetch_chunk` |
| `mega_recall`       | `mega_recall`      |

`mega_recall` is not part of the v1.2 rename and keeps its name in
both modes. The mode is read once at server startup; change the env
var and restart the bridge to switch.
