# Crawler Design: The "Readability Combo"

To ensure our Documentation Registry is high-signal and lightweight, we use a specialized crawling and transformation pipeline.

## 1. The Transformation Pipeline
Instead of a heavy Python-based crawler like `crawl4ai`, we use a deterministic, TypeScript-native stack.

### Step 1: Headless Navigation (Playwright)
- **Why:** Most modern documentation sites (React, Vue, etc.) are Single Page Applications (SPAs).
- **Function:** Renders the page and waits for content to stabilize.

### Step 2: Noise Removal (@mozilla/readability)
- **Why:** Documentation pages are full of "noise" (navbars, sidebars, search inputs, footers).
- **Function:** Uses the industry-standard "Firefox Reader View" engine to identify the core content container and prune the rest based on link-to-text density.

### Step 3: Semantic Conversion (dom-to-semantic-markdown)
- **Why:** Basic Turndown often loses structural context (like which header a table belongs to).
- **Function:** Converts the cleaned HTML into Markdown optimized for LLMs, preserving semantic relationships while being token-efficient.

## 2. Crawling Strategies

### A. Sitemap-First (Preferred)
- **Logic:** Check for `sitemap.xml` or `robots.txt` to get a flat list of all pages.
- **Benefit:** Fast, reliable, and avoids infinite loops or non-documentation pages.

### B. Recursive Scoping (Fallback)
- **Logic:** Follow internal links within the same domain and subpath (e.g., `https://example.com/docs/*`).
- **Control:** Max depth and negative regex filters (e.g., ignore `/blog`, `/community`).

## 3. Scope Considerations

### In-Scope (Phase 1)
- **Deduplication (CAS):** Integrating with the Registry's Content-Addressable Store.
- **Code Snippet Preservation:** Ensuring syntax highlighting is captured.
- **Tabbed Content Handling:** For multi-tab blocks (e.g., npm/yarn/pnpm or JS/TS), the crawler will default to **pnpm** and **TypeScript** but keep this configurable in the `sync_docs` settings.
- **Embedded Search Integration:** 
    - **Concept:** Many doc sites (Docusaurus, Starlight, etc.) publish a `search-index.json`. 
    - **Function:** If found, we ingest this index to provide a `search_library(lib, query)` tool. This allows the AI to use the library's *official* search logic to find the right page instantly, rather than naively grepping local files.

### Future / Post-V1 Features
- **LLM-Based Extraction:** Optional mode to use a model to "summarize" or "extract API schemas" during the crawl (Not critical for V1).
- **Image OCR:** Extracting text from diagrams or screenshots.
- **Interactive Component Extraction:** Trying to represent live demos (e.g., interactive Sandboxes).
- **Authentication:** Crawling private or password-protected documentation.
