# Diamond 💎

**Documentation & Repository Registry for the Model Context Protocol (MCP)**

Diamond is a high-performance documentation crawler and repository manager designed to give AI models real-time, high-signal context. It bridges the gap between an LLM's stale training data and the rapidly evolving software ecosystem.

## Why Diamond?

AI models are only as good as the context they can access. Most current solutions suffer from:
- **Stale Training Data:** Models don't know about API changes from last week.
- **Noise:** Standard web scraping includes headers, footers, and ads.
- **Divergence:** Documentation often hides critical platform-specific details (like npm vs pnpm or JS vs TS) behind tabs that scrapers miss.

Diamond solves this by providing a "pnpm-inspired" Content-Addressable Storage (CAS) for documentation, coupled with an intelligent crawler that "clicks everything" to reveal hidden content.

## How it Works

### 1. The Intelligent Crawler
Diamond uses **Playwright** to navigate modern SPAs. Unlike simple `curl`-based scrapers, it:
- **Reveals All Content:** Automatically identifies and clicks UI toggles (tabs, dropdowns, code switchers) to ensure both TypeScript and JavaScript examples are captured.
- **Noise Reduction:** Uses `@mozilla/readability` and `dom-to-semantic-markdown` to transform messy HTML into clean, structured Markdown.
- **Parallel Workers:** A pool of parallel browsers ensures rapid ingestion of large doc sites.

### 2. CAS-based Storage
Inspired by `pnpm`, Diamond stores content in `~/.local/share/diamond/store` using SHA-256 hashes.
- **Deduplication:** Identical Markdown files across different versions of a library are stored only once.
- **Symbolic Registry:** A central `registry.json` tracks library versions and local repository paths, mapping them to the CAS store.

### 3. MCP Integration
Diamond exposes everything via an **MCP Server**. AI models can:
- **Resource Templates:** Access docs via URIs like `docs://{lib}/{version}/{path}`.
- **Full-Text Search:** Query libraries using an integrated `minisearch` engine.
- **Symbolic Access:** Read specific files from local repositories tracked by the registry.

## Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/diamond.git
cd diamond

# Install dependencies
pnpm install

# Build the project
pnpm run build

# Link for global CLI usage
npm link
```

## Usage

### Ingesting Documentation
```bash
# Crawl a documentation site
diamond crawl https://sdk.vercel.ai/docs --name ai-sdk

# Ingest a specific version
diamond crawl https://lexical.dev/docs/intro --name lexical --ver 0.17.0
```

### Managing Local Repos
```bash
# Add a local repository to the registry
diamond repo add ~/work/my-project --name my-project
```

### Running the MCP Server
Add the following to your `claude_desktop_config.json`:

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

## Tech Stack
- **Runtime:** Node.js (ESM)
- **Crawler:** Playwright
- **Transformation:** @mozilla/readability, dom-to-semantic-markdown
- **Search:** MiniSearch
- **Storage:** Content-Addressable Storage (SHA-256)
- **CLI:** Commander.js
