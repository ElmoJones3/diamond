# MCP Server

Diamond exposes its capabilities to AI assistants via the Model Context Protocol (MCP). The server runs over stdio — the AI host (Claude Desktop, Cursor, etc.) spawns Diamond as a child process and communicates through JSON-RPC messages on stdin/stdout.

## Starting the Server

```bash
diamond serve
```

Or configure it in your AI host's MCP settings (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "diamond": {
      "command": "diamond",
      "args": ["serve"]
    }
  }
}
```

## Resources

Resources are read-only content the AI can pull into its context window. Diamond exposes two resource namespaces.

### `docs://{lib}/{version}/{+path}`

Serves a single Markdown documentation page from local storage.

| Segment | Description |
|---|---|
| `lib` | The library identifier (e.g. `msw`, `zod`) |
| `version` | A pinned version (`2.12.10`) or `latest` |
| `path` | The relative path to the Markdown file (may contain slashes) |

**Example URIs**
```
docs://msw/latest/api/handlers
docs://msw/2.12.10/getting-started
docs://zod/latest/primitives/string
```

The list callback returns all synced `docs` libraries at their `latest` version.

### `repo://{repo}/{+path}`

Serves a file from a locally indexed git repository. Unlike docs, the file is read directly from the original checkout — no copying occurs.

| Segment | Description |
|---|---|
| `repo` | The repository identifier from the registry |
| `path` | The file path relative to the repository root |

**Example URIs**
```
repo://diamond-core/src/mcp/server.ts
repo://my-library/src/index.ts
repo://my-library/README.md
```

The list callback returns all `repo` entries from the registry.

## Tools

Tools are callable functions the AI can invoke to take actions or fetch structured data.

### `list_registry`

List everything Diamond currently knows about.

**No inputs.**

**Returns:** The full registry manifest as pretty-printed JSON — all synced `docs` libraries with their version history, and all registered `repo` entries.

**Typical use:** Call this first to see what's available before deciding which library to search or which resource to read.

---

### `search_library`

Full-text search across a library's stored documentation.

| Input | Type | Description |
|---|---|---|
| `lib` | `string` | Library identifier (must be synced) |
| `query` | `string` | Keywords or a short phrase |
| `version` | `string?` | Version to search (default: `"latest"`) |

**Returns:** JSON array of matches, sorted by relevance score:
```json
[
  {
    "title": "Handlers — Mock Service Worker",
    "uri": "docs://msw/latest/api/handlers.md",
    "score": 14.2
  }
]
```

The returned URIs can be passed directly to the `docs://` resource to fetch the full page.

Search uses MiniSearch with prefix matching (partial words), 20% fuzzy tolerance, and 2× weighting on title matches.

---

### `sync_docs`

Crawl a documentation site and store it in Diamond's registry.

| Input | Type | Description |
|---|---|---|
| `lib` | `string` | Short identifier to register under (e.g. `"msw"`) |
| `url` | `string` | Root URL of the documentation site |
| `recursive` | `boolean?` | Follow sub-page links (default: `true`) |
| `limit` | `number?` | Cap on total pages crawled |

**Returns:** A success message on completion.

**Effect:** Crawls the site, writes content to the CAS, builds a search index, and updates the registry. After this call, the library is available via `docs://` resources and `search_library`.

This is a blocking operation — it waits for the full crawl and ingestion to complete before returning.

## Recommended Workflow

A typical AI session using Diamond:

```
1. list_registry
   → see what's already synced

2. sync_docs({ lib: "msw", url: "https://mswjs.io/docs", recursive: true })
   → (if the library isn't synced yet)

3. search_library({ lib: "msw", query: "request handlers" })
   → find relevant pages

4. read resource docs://msw/latest/api/handlers
   → read the full page content
```

## Implementation Notes

**Why `console.warn` for log output?**
When running as an MCP server, stdout is the JSON-RPC transport channel. Any non-protocol output written to stdout corrupts the stream. Diamond routes all human-readable output (progress messages, errors) to stderr via `console.warn` / `console.error`, which MCP hosts safely ignore.

**Why stdio instead of SSE?**
Stdio is the simplest transport for a local tool: no port management, no authentication, no firewall issues. The MCP SDK supports SSE for remote servers — that's on the roadmap for Diamond's multi-machine use case.
