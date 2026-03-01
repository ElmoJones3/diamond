# Changelog

All notable changes to Diamond will be documented here.

## [0.1.0] — 2025

Initial release.

### Added
- `diamond sync` — crawl a documentation site and store it in the global registry
- `diamond crawl` — one-shot crawl to a local directory
- `diamond serve` — MCP server over stdio
- `diamond repo add` — register a local git repository
- Content-addressable store with SHA-256 hashing and atomic writes
- Versioned storage directories with hardlinks and `latest` symlink
- Sitemap discovery (sitemap.xml, sitemap_index.xml, robots.txt)
- Playwright-based rendering with tab panel revealing for Docusaurus/Starlight
- Mozilla Readability for noise removal
- dom-to-semantic-markdown for LLM-friendly output
- MiniSearch full-text index built at sync time
- MCP resources: `docs://{lib}/{version}/{+path}`, `repo://{repo}/{+path}`
- MCP tools: `sync_docs`, `search_library`, `list_registry`
- XDG-compliant filesystem paths
