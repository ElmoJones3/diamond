# Tech Stack: The Rationale

To ensure the Documentation Registry is portable, high-signal, and easy to distribute, we've selected a **TypeScript/Node.js**-native stack.

## 1. Core Language & Runtime
- **Language:** TypeScript
- **Runtime:** Node.js (with XDG compliance for Linux/macOS/Windows)
- **Rationale:** The MCP SDK is first-class in TypeScript, and the library ecosystem for web scraping (Playwright) and HTML transformation (Readability.js) is most mature in Node.js.

## 2. The "Readability Combo" (Transformation)
To extract high-signal Markdown without heavy Python sidecars or LLM costs:

- **[Playwright](https://playwright.dev/):** For rendering SPA-heavy documentation (React, Vue, Docusaurus, Starlight).
- **[@mozilla/readability](https://github.com/mozilla/readability):** The Firefox Reader View engine. It's deterministic and prunes navbars/footers/sidebars based on text density.
- **[dom-to-semantic-markdown](https://www.npmjs.com/package/dom-to-semantic-markdown):** Specifically designed for LLMs. It preserves semantic structure (tables, headers) better than standard Turndown.

## 3. Storage & Registry Logic
- **Hashing:** `crypto` (SHA256) for the Content-Addressable Store (CAS).
- **Filesystem:** Native Node `fs` for hardlinks and symlinks (pnpm-style deduplication).
- **Manifest:** A local `registry.json` (global config) and per-version `index.json` files for metadata.

## 4. MCP Interface
- **[@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk):** The reference implementation for MCP.
- **Transport:** Primarily **stdio** (for local CLI use) with planned support for SSE (Server-Sent Events) for remote use.

## 5. Summary: Why not Python/Crawl4AI?
While Crawl4AI is excellent, it introduces heavy dependencies (Python, multiple NLP libs, often Docker). By choosing a TS-native "Readability Combo," we deliver a **zero-dependency-binary** experience for the end-user. `npm install -g mcp-docs` is the target distribution model.
