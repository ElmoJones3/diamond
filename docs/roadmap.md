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
- [x] Recursive link-following with same-origin/scope-prefix filtering
- [x] Tab panel revealing for Docusaurus / Starlight content
- [x] Parallel worker loop (configurable concurrency)
- [x] Version detection from URL patterns and HTML meta tags

## Phase 3: MCP Interface ✅
- [x] MCP server (stdio transport) using the TypeScript SDK
- [x] `sync_docs` tool — trigger a full sync from the AI
- [x] `search_library` tool — keyword search via MiniSearch
- [x] `list_registry` tool — enumerate synced libraries and repos
- [x] `docs://{lib}/{version}/{+path}` resource — serve Markdown pages
- [x] `repo://{repo}/{+path}` resource — serve local repo files

## Phase 4: CLI & DX ✅
- [x] `diamond sync` — sync docs into the global registry
- [x] `diamond crawl` — one-shot crawl to a local directory
- [x] `diamond serve` — launch the MCP server
- [x] `diamond repo add` — register a local git repository
- [x] XDG-compliant filesystem paths (data, config, cache)
- [x] MiniSearch index built and persisted at sync time

## Up Next
- [ ] `diamond repo sync` — `git pull` tracked repositories
- [ ] NPM/PyPI/Go discovery: auto-find docs URL from package name
- [ ] SSE transport for remote/multi-machine use
- [ ] `diamond sync --check` — re-sync only if upstream version changed
- [ ] `diamond rm` — remove a library from the registry and reclaim disk space
- [ ] Prompts: `library-expert(lib)` for context injection
