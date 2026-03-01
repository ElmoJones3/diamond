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

---

### `diamond repo add <path>`

Register and index a local git repository.

```bash
diamond repo add ~/work/my-library --key my-lib
```

Diamond will perform an initial indexing of the repository (Markdown and code files) so it is immediately searchable via MCP. It does not copy any files — it reads directly from your checkout.

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
diamond install --gemini-cli --claude-code --cursor
```

| Flag | Target Path |
|---|---|
| `--gemini-cli` | `~/.gemini/settings.json` |
| `--claude-code` | `~/.claude.json` |
| `--claude-desktop` | `~/Library/Application Support/Claude/...` |
| `--cursor` | `~/.cursor/mcp.json` |

---

### `diamond remove <id>`

Remove a library or repository from the registry.

```bash
diamond remove msw
```

For `docs` entries, this also deletes the versioned storage directory to reclaim disk space. For `repo` entries, it only removes the registry record (your code is safe).

---

### `diamond serve`

Start the Diamond MCP server over stdio. Configure this command in your AI host's settings to enable Diamond's capabilities.

## Shared Behavior

**Respectful Crawling.** Diamond identifies as `DiamondCrawler` and respects `robots.txt` directives (Disallow/Allow).

**stdout is clean.** All progress output goes to stderr (`console.warn`). 

**Exit codes.** All commands exit `0` on success, `1` on any fatal error.
