# Roadmap: Execution Phases

From a Research & Strategy phase to a production-ready MCP Doc Registry.

## Phase 1: Registry Core (The Storage Layer)
**Goal:** Build the CAS-based storage system that allows multiple versions to coexist efficiently.

- [ ] Define the `registry.json` and `index.json` schemas.
- [ ] Implement the **Content-Addressable Store (CAS)** (hashing content -> `$DATA_DIR/store/{sha256}`).
- [ ] Implement the **Storage Manager** (creating hardlinks/symlinks for versioned pages).
- [ ] Implement the **Registry Manifest** (tracking synced libraries and versions).

## Phase 2: Crawler Service (The Ingestion Layer)
**Goal:** Build the "Readability Combo" crawler that transforms HTML into high-signal Markdown.

- [ ] Setup **Playwright** with a headless browser configuration.
- [ ] Integrate **Readability.js** for noise-removal (pruning navbars, footers, etc.).
- [ ] Integrate **dom-to-semantic-markdown** for high-quality LLM-ready conversion.
- [ ] Implement **Sitemap Discovery** and **Recursive Scoping** logic.
- [ ] Implement **Sync Idempotency** (checking for updates via hashes or last-modified headers).

## Phase 3: MCP Interface (The Connector Layer)
**Goal:** Expose the Registry and Crawler to any AI Host (Claude, Gemini, etc.).

- [ ] Implement the **MCP Server** using the TypeScript SDK.
- [ ] Define and implement the **Tools**:
    - `sync_docs(lib, url, config?)`
    - `list_synced_libs()`
    - `search_library(lib, query)` (if embedded search index found).
- [ ] Define and implement the **Resources**:
    - `docs://{lib}/{version}/{path}`
    - `docs://{lib}/latest/{path}`
- [ ] Define and implement the **Prompts**:
    - `library-expert(lib)` (Context injection).

## Phase 4: Distribution & DX
**Goal:** Make it easy for anyone to use and contribute.

- [ ] Create a CLI for direct usage (`mcp-docs sync msw`).
- [ ] Add support for **Discovery Tools** (NPM, Go, PyPI) to automatically find doc URLs.
- [ ] Finalize the global configuration (XDG compliance).
- [ ] Documentation for contributing new "Discovery" strategies.

---

### Current Status: Ready to start Phase 1.
- Research & Strategy: **Completed**
- Registry Spec: **Defined**
- Crawler Strategy: **Selected**
- Tech Stack: **Approved**
- Implementation: **Pending**
