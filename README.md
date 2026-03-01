# Diamond

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-elmojones3-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/elmojones3)

Sync documentation once. Read it offline forever. Give your AI assistant access to up-to-date docs without a network call.

Diamond is a CLI tool and MCP server that crawls documentation sites, stores them locally using content-addressable storage, and exposes them to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

## The Problem

AI assistants hallucinate API details, miss recent changes, and have no awareness of your private code. Diamond fixes this by giving them a local, searchable copy of the exact docs you're working with — synced once, served instantly.

## Quick Start

```bash
# Install
npm install -g diamond

# Sync a library's docs (once)
diamond sync https://mswjs.io/docs --key msw --recursive

# Connect to your AI assistant
diamond serve
```

Then in Claude Desktop, Cursor, or any MCP host, your assistant can search and read MSW's docs directly — no internet required.

## How It Works

**1. Crawl with a real browser.**
Diamond uses Playwright to render pages the same way Chrome does. It waits for JavaScript frameworks to hydrate, then clicks through tab panels and code switchers to capture content that plain scrapers miss.

**2. Extract the signal.**
Mozilla Readability (the Firefox Reader View engine) strips navbars, sidebars, and footers. `dom-to-semantic-markdown` converts the clean HTML to structured Markdown that LLMs read well.

**3. Store without duplication.**
Content is hashed with SHA-256 and stored once, regardless of how many library versions reference it — the same approach pnpm uses for packages. Versioned directories are hardlinks into this store, so multiple versions cost almost nothing extra.

**4. Serve over MCP.**
`diamond serve` exposes everything to any MCP-compatible AI host via tools and resource URIs:

```
docs://msw/latest/api/handlers     ← read a specific page
repo://my-library/src/index.ts     ← read a file from a local repo
```

## CLI

```bash
# Sync docs into the registry (use this for MCP access)
diamond sync <url> --key <name> --recursive

# One-shot crawl to a local directory (no registry)
diamond crawl <url> --key <name> --recursive

# Start the MCP server
diamond serve

# Register a local git repository
diamond repo add <path> --key <name>
```

## MCP Tools

Once `diamond serve` is running, your AI assistant has access to:

| Tool | What it does |
|---|---|
| `list_registry` | List all synced libraries and repos |
| `sync_docs` | Crawl and sync a library (callable from the AI) |
| `search_library` | Full-text search across a library's docs |

## MCP Setup

Add Diamond to your AI host's MCP configuration:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
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

**Cursor** (`.cursor/mcp.json`):
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

## Storage Layout

Diamond follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/). Override any path with the standard XDG environment variables.

```
~/.config/diamond/registry.json    ← manifest of all synced libraries
~/.local/share/diamond/store/      ← content-addressable store (SHA-256)
~/.local/share/diamond/storage/    ← versioned views (hardlinked from store)
```

## Requirements

- Node.js 18+
- Playwright (installed automatically as a dependency; run `npx playwright install chromium` on first use)

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

[MIT](LICENSE)
