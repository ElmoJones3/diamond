# MCP Server

Diamond exposes its capabilities to AI assistants via the Model Context Protocol (MCP). The server runs over stdio — the AI host (Claude Desktop, Cursor, Gemini CLI, etc.) spawns Diamond as a child process and communicates through JSON-RPC messages on stdin/stdout.

## Starting the Server

```bash
diamond serve
```

Or configure it in your AI host's MCP settings using `diamond install`.

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
```

## Tools

Tools are callable functions the AI can invoke to take actions or fetch structured data.

### `list_registry`

List everything Diamond currently knows about.

**No inputs.**

**Returns:** The full registry manifest as pretty-printed JSON — all synced `docs` libraries with their version history, and all registered `repo` entries.

---

### `search_library`

Hybrid (Keyword + Semantic) search across a library's docs or a repository's files.

| Input | Type | Description |
|---|---|---|
| `lib` | `string` | Library identifier (must be synced) |
| `query` | `string` | Keywords or a natural language question |
| `version` | `string?` | Version to search (default: `"latest"`) |

**Returns:** JSON array of matches, sorted by relevance score.

Search uses a hybrid strategy: **MiniSearch** for exact technical terms and **SBERT vectors** (`all-MiniLM-L6-v2`) for conceptual matching. This allows the AI to find relevant pages even if the exact keywords are missing.

---

### `sync_docs`

Crawl a documentation site and store it in Diamond's registry.

| Input | Type | Description |
|---|---|---|
| `lib` | `string` | Short identifier to register under (e.g. `"msw"`) |
| `url` | `string` | Root URL of the documentation site |
| `recursive` | `boolean?` | Follow sub-page links (default: `true`) |
| `limit` | `number?` | Cap on total pages crawled |
| `description` | `string?` | Short description stored in the registry |
| `version` | `string?` | Pin a specific version (default: auto-detect from URL/meta tags) |

The `description` field is optional but useful — when the AI calls `sync_docs` it already knows what the library is, so it can populate this itself. It surfaces in `list_registry` to help orient future sessions.

**Returns:** A success message on completion.

---

### `remove_library`

Remove a library or repository from Diamond's registry.

| Input | Type | Description |
|---|---|---|
| `id` | `string` | The registry identifier to remove (e.g. `"msw"`, `"diamond-core"`) |

For `docs` entries, the versioned storage directory is deleted and disk space is reclaimed. CAS blobs (the SHA256 content store) are left intact as they may be shared with other libraries. For `repo` entries, only the registry record is removed — the repository on disk is untouched.

**Returns:** A success message on completion.

---

### `describe_library`

Set or update the description on a registry entry without re-syncing.

| Input | Type | Description |
|---|---|---|
| `id` | `string` | The registry identifier to update |
| `description` | `string` | The description to set |

Useful for annotating entries that were registered before the description field was introduced, or for repos where there is no re-sync path.

**Returns:** A success message on completion.

---

### `list_repo_files`

List the files in a registered repository so the AI can discover what to read.

| Input | Type | Description |
|---|---|---|
| `id` | `string` | The repository identifier from the registry |
| `path` | `string?` | Subdirectory to scope the listing to (default: entire repo) |

Returns a sorted list of `{ path, uri }` objects. Skips `.git`, `node_modules`, `dist`, and binary/lock files. Use the returned `repo://` URIs directly with the Repository File resource to read specific files.

**Returns:** JSON array of `{ path: string, uri: string }`.

## Recommended Workflow

A typical AI session using Diamond:

```
1. list_registry
   → see what's already synced

2. sync_docs({ lib: "msw", url: "https://mswjs.io/docs", recursive: true })
   → (if the library isn't synced yet)

3. search_library({ lib: "msw", query: "request handlers" })
   → find relevant pages using hybrid search

4. read resource docs://msw/latest/api/handlers
   → read the full page content
```

## Implementation Notes

**Why `console.warn` for log output?**
When running as an MCP server, stdout is the JSON-RPC transport channel. Any non-protocol output written to stdout corrupts the stream. Diamond routes all human-readable output (progress messages, errors) to stderr via `console.warn` / `console.error`, which MCP hosts safely ignore.

**Why stdio instead of SSE?**
Stdio is the simplest transport for a local tool: no port management, no authentication, no firewall issues.
