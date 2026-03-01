# Diamond — Architecture Overview

Diamond is a documentation registry and MCP server. Its job is to crawl documentation sites once, store them efficiently on disk, and make them available to AI assistants offline via the Model Context Protocol.

## The Big Picture

```
User / AI Host
      │
      ▼
┌─────────────┐       ┌──────────────────────────────────────────┐
│  CLI        │       │  MCP Server (stdio)                      │
│  diamond    │       │  tools: sync_docs, search_library,       │
│  sync       │       │         list_registry                    │
│  crawl      │       │  resources: docs://{lib}/{ver}/{path}    │
│  serve      │       │            repo://{repo}/{path}          │
│  repo add   │       └───────────────┬──────────────────────────┘
└──────┬──────┘                       │
       │          both call           │
       └──────────────────────────────┘
                       │
              ┌────────┴────────┐
              │   CLI layer     │  src/cli/
              │  sync.ts        │  Orchestrates the 5-stage sync pipeline
              │  crawl.ts       │  One-shot crawl to local directory
              │  repo.ts        │  Register a local git repo
              └────────┬────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
┌──────┴──────┐ ┌──────┴──────┐ ┌─────┴──────┐
│  Crawler    │ │  Core       │ │ Transformer│
│  crawler.ts │ │  registry   │ │ html-to-   │
│  browser.ts │ │  storage    │ │ markdown   │
│  walker.ts  │ │  search     │ └────────────┘
│  discovery  │ │  cas        │
└─────────────┘ │  env        │
                └─────────────┘
```

## Layers

### CLI (`src/index.ts`, `src/cli/`)
The user-facing entry point. Built with Commander.js. Each command is a thin argument-parsing wrapper that delegates to a function in `src/cli/`. The MCP server and CLI share the same underlying functions — `sync_docs` calls `syncCommand()` directly.

### MCP Server (`src/mcp/server.ts`)
Wraps Diamond's capabilities in the Model Context Protocol. Exposes resources (readable content) and tools (callable functions). Communicates over stdio — the host process reads/writes JSON-RPC messages on stdin/stdout.

### Crawler (`src/crawler/`)
A four-file subsystem responsible for turning a URL into a list of `{ url, path, content, title }` objects:
- **`crawler.ts`** — orchestrator: sitemap discovery → parallel page processing
- **`browser.ts`** — Playwright lifecycle and SPA content revealing
- **`walker.ts`** — link extraction and scope filtering from rendered pages
- **`discovery.ts`** — sitemap/robots.txt pre-crawl URL discovery and version detection

### Transformer (`src/transformer/`)
Converts raw rendered HTML into clean Markdown using a two-step pipeline:
1. Mozilla Readability strips navigation, sidebars, and noise
2. dom-to-semantic-markdown converts the clean HTML to LLM-friendly Markdown

### Core (`src/core/`)
The storage and metadata layer:
- **`cas.ts`** — content-addressable store (SHA256-keyed, atomic writes)
- **`storage.ts`** — versioned directory views via hardlinks + `latest` symlink
- **`registry.ts`** — JSON manifest of all synced libraries and repos
- **`search.ts`** — per-library MiniSearch index (build + query)
- **`env.ts`** — XDG-compliant filesystem paths

## Data Flow: A Full Sync

```
diamond sync https://mswjs.io/docs --key msw --recursive

1. CrawlerService.crawl()
   ├── DiscoveryService.discoverFromSitemaps()  → seed URL list from sitemap.xml
   └── [parallel workers, concurrency=5]
       ├── BrowserService.getPage()             → headless Chromium, wait networkidle
       ├── BrowserService.revealAllContent()    → click tab panels
       ├── page.content()                       → full rendered HTML
       ├── TransformerService.transform()       → Readability + dom-to-semantic-markdown
       └── WalkerService.discoverUrls()         → extract links, filter to scope

2. DiscoveryService.resolveVersion()            → detect "2.12.10" from URL/meta

3. StorageManager.createVersion()
   └── per file:
       ├── CasStore.save()                      → SHA256 hash → write to store/ab/abcdef...
       └── fs.link()                            → hardlink store → storage/msw/2.12.10/api/handlers.md
       └── updateLatest()                       → symlink storage/msw/latest → 2.12.10

4. SearchService.indexVersion()                 → build MiniSearch index → search-index.json

5. RegistryManager.addEntry()                   → update registry.json
```

## Key Design Decisions

**Why CAS + hardlinks?**
Multiple versions of the same library often share many identical pages (a changelog, a getting-started guide). Storing content by hash means identical pages are stored once regardless of how many versions reference them. Hardlinks give each version a complete directory view with zero data duplication.

**Why Playwright instead of fetch?**
Modern doc sites (Docusaurus, VitePress, Nextra, Starlight) are JavaScript SPAs. Plain fetch only returns an HTML shell; the content is injected after hydration. Playwright renders the full page the same way a browser would.

**Why a local registry instead of a server?**
Diamond is a personal tool — it runs on the developer's machine alongside their AI assistant. A local JSON manifest is zero-infrastructure, trivially backed up, and works without a network connection after the initial sync.

**Why MiniSearch instead of a vector database?**
Offline-first. Vector databases need either a running server or embedding calls. MiniSearch is in-process, stores as plain JSON, and works instantly after sync with no additional setup.
