# Diamond

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-elmojones3-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/elmojones3) [![CI](https://github.com/ElmoJones3/diamond/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ElmoJones3/diamond/actions/workflows/ci.yml)

I got tired of watching an AI agent make fourteen tool calls to resolve a TanStack issue.

Diamond is a documentation registry and MCP server. It crawls a docs site once, stores the content locally, and serves it to your AI assistant on demand — no network call, no hallucinated APIs, no nonsense.

Inspired by pnpm.

If you like it, well then, I made this for you.

## Quick Start

```bash
# get the code
git clone https://github.com/elmojones3/diamond.git

# navigate to it
cd diamond

# install dependencies
pnpm install

# (optional) makes `diamond` available globally
pnpm link --global

# Sync a library's docs
diamond sync https://mswjs.io/docs --key msw --recursive

# Install as an MCP server (Claude Code, Claude Desktop, Cursor, Gemini CLI, or Codex)
diamond install --claude-code

# Start the MCP server
diamond serve
```

That's it. Your AI assistant now has offline access to MSW's documentation.

## How It Works

**1. Crawl with a real browser.**
Diamond uses Playwright to render pages the same way Chrome does. It waits for JavaScript frameworks to hydrate, then clicks through tab panels and code switchers to capture content that plain scrapers miss. It respects `robots.txt` and identifies as `DiamondCrawler`.

**2. Extract the signal.**
Mozilla Readability (the Firefox Reader View engine) strips navbars, sidebars, and footers. `dom-to-semantic-markdown` converts the clean HTML to structured Markdown that LLMs read well.

**3. Hybrid Search (Keyword + Semantic).**
Diamond builds two indices for every library: a fast MiniSearch keyword index and a semantic vector index using `all-MiniLM-L6-v2`. This allows your AI to find exact technical terms *and* conceptually related content (e.g. searching for "problems" finds "Error Handling") fully offline.

**4. Store without duplication.**
Content is hashed with SHA-256 and stored once, regardless of how many library versions reference it. Versioned directories are hardlinks into this store, so multiple versions cost almost nothing extra.

**5. Serve over MCP.**
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

# Register a local git repository (immediately indexed and searchable)
diamond repo add <path> --key <name>

# Watch registered repos and keep their indices up to date as files change
diamond watch

# Remove a library or repo from the registry (reclaims disk space for docs)
diamond remove <id>

# Automatic MCP configuration
diamond install --claude-code --claude-desktop --cursor --gemini-cli --codex
```

## MCP Tools

Once `diamond serve` is running, your AI assistant has access to:

| Tool | What it does |
|---|---|
| `list_registry` | List all synced libraries and repos |
| `sync_docs` | Crawl and sync a library (callable from the AI) |
| `search_library` | Hybrid search (keyword + semantic) across docs or repos |
| `remove_library` | Remove a library or repo from the registry |

## MCP Setup

You can use `diamond install` to automatically configure your tools, or manually edit your configuration files:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "diamond": {
      "command": "diamond",
      "args": ["mcp"]
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
      "args": ["mcp"]
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

- Node.js 22+
- pnpm
- Playwright / Chromium — on first use, run `npx playwright install chromium`

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

[MIT](LICENSE)
