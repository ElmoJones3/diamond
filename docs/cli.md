# CLI Reference

Diamond is invoked as `diamond <command>`. All human-readable output goes to stderr so the tool is safe to use in scripts and as an MCP server simultaneously.

## Commands

### `diamond sync <url>`

Crawl a documentation site and store it in Diamond's global registry.

```bash
diamond sync https://mswjs.io/docs --key msw --recursive
diamond sync https://zod.dev --key zod --recursive --limit 50
diamond sync https://lexical.dev/docs --key lexical --ver 0.21.0
```

| Option | Default | Description |
|---|---|---|
| `--key <name>` | `"docs"` | Registry identifier for this library |
| `--ver <string>` | `"latest"` | Pin a specific version. If "latest", Diamond tries to auto-detect from the URL or page meta tags |
| `--recursive` | `false` | Follow internal links to crawl sub-pages (almost always what you want) |
| `--concurrency <n>` | `5` | Pages to process simultaneously |
| `--limit <n>` | none | Stop after this many pages (useful for testing on large sites) |

**After a successful sync:**
- Pages are available via `docs://{key}/{version}/{path}` MCP resources
- `search_library` works for the library
- The registry is updated at `~/.config/diamond/registry.json`

---

### `diamond crawl <url> [outDir]`

Crawl a documentation site and write Markdown files to a local directory. Does not touch the global registry or CAS.

```bash
diamond crawl https://mswjs.io/docs --key msw --recursive
diamond crawl https://mswjs.io/docs ./output --key msw --recursive --limit 20
```

| Option | Default | Description |
|---|---|---|
| `--key <name>` | `"docs"` | Subdirectory name under `outDir` |
| `--recursive` | `false` | Follow internal links |
| `--concurrency <n>` | `5` | Pages to process simultaneously |
| `--limit <n>` | none | Stop after this many pages |

**Output structure:**
```
{outDir}/{key}/
  api/handlers.md
  getting-started.md
  index.json           ← manifest: { url → { title, path } }
```

Use `crawl` when you want to inspect raw Markdown output or feed it to another tool. Use `sync` for everything else.

---

### `diamond serve`

Start the Diamond MCP server over stdio.

```bash
diamond serve
```

No options. The server runs until the host process kills it. See [mcp-server.md](./mcp-server.md) for the full list of tools and resources exposed.

Configure in Claude Desktop (`claude_desktop_config.json`):
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

---

### `diamond repo add <path>`

Register a local git repository so Diamond can serve its files over MCP.

```bash
diamond repo add ~/work/my-library
diamond repo add ~/work/my-library --key my-lib
```

| Option | Default | Description |
|---|---|---|
| `--key <name>` | directory name | Registry identifier |

After registration, the repo is available via `repo://{key}/{path}` MCP resources. Diamond does not copy any files — it reads directly from the original checkout.

The path must point to a directory containing a `.git` folder.

## Shared Behavior

**stdout is clean.** All progress output goes to stderr (`console.warn`). This means `diamond serve` can run as an MCP server without corrupting the JSON-RPC stream, and other commands can be safely piped.

**Exit codes.** All commands exit `0` on success, `1` on any fatal error.

**Concurrency default.** All crawling commands default to 5 parallel pages. Raise this on fast networks, lower it if a site starts rate-limiting you.
