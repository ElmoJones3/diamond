# CLI Reference

Diamond is invoked as `diamond <command>`. All human-readable output goes to stderr so the tool is safe to use in scripts and as an MCP server simultaneously.

## Commands

### `diamond sync <url>`

Crawl a documentation site and store it in Diamond's global registry.

```bash
diamond sync https://mswjs.io/docs --key msw --recursive
diamond sync https://zod.dev --key zod --recursive --limit 50
```

| Option | Default | Description |
|---|---|---|
| `--key <name>` | `"docs"` | Registry identifier for this library |
| `--ver <string>` | `"latest"` | Pin a specific version. If "latest", Diamond auto-detects version |
| `--recursive` | `false` | Follow internal links to crawl sub-pages |
| `--concurrency <n>` | `5` | Pages to process simultaneously |
| `--limit <n>` | none | Stop after this many pages |
| `--description <text>` | none | Short description stored in the registry (e.g. `"API mocking library"`) |

---

### `diamond repo add <path>`

Register and index a local git repository.

```bash
diamond repo add ~/work/my-library --key my-lib
```

Diamond indexes the repository immediately (Markdown and source files) so it is searchable via MCP from the first request. It does not copy any files — it reads directly from your checkout.

| Option | Default | Description |
|---|---|---|
| `--key <name>` | directory name | Registry identifier for this repo |
| `--description <text>` | none | Short description stored in the registry |

---

### `diamond watch`

Start the live reference watcher for local repositories.

```bash
diamond watch
```

Keeps a long-running process that monitors all registered local repositories. When you save a file, Diamond incrementally updates its keyword and semantic search indices so your AI assistant has "live" context of your code changes.

---

### `diamond install`

Automatically configure Diamond as an MCP server in your tools.

```bash
diamond install --gemini-cli --claude-code --cursor --codex
```

| Flag | Target Path |
|---|---|
| `--gemini-cli` | `~/.gemini/settings.json` |
| `--claude-code` | `~/.claude.json` |
| `--claude-desktop` | `~/Library/Application Support/Claude/...` |
| `--cursor` | `~/.cursor/mcp.json` |
| `--codex` | `~/.codex/config.toml` |

---

### `diamond repo remove <id>`

Remove a repository from the registry. Alias for `diamond remove <id>` scoped to the `repo` subcommand for symmetry with `diamond repo add`.

```bash
diamond repo remove my-library
```

---

### `diamond gc`

Garbage collect the content-addressable store.

```bash
diamond gc
```

When a docs library is removed, its versioned storage directory is deleted but the underlying CAS blobs are left behind — they may be shared across library versions. `diamond gc` scans every blob in the store and removes any that have no hardlinks from versioned storage, reclaiming their disk space. Safe to run at any time.

---

### `diamond remove <id>`

Remove a library or repository from the registry.

```bash
diamond remove msw
```

For `docs` entries, this also deletes the versioned storage directory to reclaim disk space. For `repo` entries, it only removes the registry record (your code is safe).

---

### `diamond mcp`

Start the Diamond MCP server over stdio. Configure this command in your AI host's settings to enable Diamond's capabilities.

---

### `diamond serve`

Start a persistent HTTP MCP server (foreground by default).

```bash
diamond serve
diamond serve --port 7777
diamond serve --bg
```

The HTTP MCP endpoint is available at `http://127.0.0.1:<port>/mcp`.

| Option | Default | Description |
|---|---|---|
| `--port <number>` | `DIAMOND_PORT` or `65535` | Port to bind on `127.0.0.1` |
| `--bg` | `false` | Run as a detached background daemon |

---

### `diamond view server`

Inspect the background HTTP server and tail logs.

```bash
diamond view server
```

Displays PID, port, uptime, endpoint URL, then follows `diamond.log` until interrupted.

## Shared Behavior

**Respectful Crawling.** Diamond identifies as `DiamondCrawler` and respects `robots.txt` directives (Disallow/Allow).

**stdout is clean.** All progress output goes to stderr (`console.warn`). 

**Environment Variables.**
- `DIAMOND_PORT`: default port for `diamond serve` (used when `--port` is not provided).

**Exit codes.** All commands exit `0` on success, `1` on any fatal error.
