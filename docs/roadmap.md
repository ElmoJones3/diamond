# Roadmap

## Phase 1: Registry Core ✅
- [x] Define the `registry.json` schema (Zod-validated discriminated union)
- [x] Content-Addressable Store with SHA256 hashing and atomic writes
- [x] Storage Manager: versioned directories via hardlinks + `latest` symlink
- [x] Registry Manager: in-memory Map backed by `registry.json`

## Phase 2: Crawler Service ✅
- [x] Headless Chromium via Playwright with `networkidle` wait strategy
- [x] Readability.js for noise removal (navbars, sidebars, footers)
- [x] dom-to-semantic-markdown for LLM-friendly Markdown output
- [x] Sitemap discovery (sitemap.xml, sitemap_index.xml, robots.txt)
- [x] Respectful crawling via `robots-parser` (DiamondCrawler user agent)
- [x] Recursive link-following with same-origin/scope-prefix filtering
- [x] Tab panel revealing for Docusaurus / Starlight content
- [x] Parallel worker loop (configurable concurrency)
- [x] Version detection from URL patterns and HTML meta tags

## Phase 3: Hybrid Search ✅
- [x] MiniSearch keyword index built and persisted at sync time
- [x] Local semantic embeddings via Transformers.js (`all-MiniLM-L6-v2`)
- [x] Hybrid reranking (Keyword scores + Vector similarity)
- [x] Incremental indexing for local repositories

## Phase 4: CLI & MCP Interface ✅
- [x] `diamond watch` — live re-indexing for local repos (Chokidar)
- [x] `diamond install` — automatic MCP configuration for major tools
- [x] `diamond remove` / `diamond repo remove` — remove libraries and repos from the registry
- [x] `diamond gc` — garbage collect orphaned CAS blobs after removes
- [x] `search_library` tool updated for hybrid search and repo support
- [x] `describe_library` MCP tool — annotate registry entries without re-syncing
- [x] `list_repo_files` MCP tool — browse a registered repo's file tree
- [x] `sync_docs` MCP tool exposes version pinning
- [x] Optional `description` field on all registry entry types
- [x] XDG-compliant filesystem paths (data, config, cache)

## Up Next
- [ ] `diamond repo sync` — `git pull` tracked repositories
- [ ] NPM/PyPI/Go discovery: auto-find docs URL from package name
- [ ] SSE transport for remote/multi-machine use
- [ ] `diamond sync --check` — re-sync only if upstream version changed
- [ ] Improved chunking heuristics for source code vs markdown
- [ ] Prompts: `library-expert(lib)` for context injection
