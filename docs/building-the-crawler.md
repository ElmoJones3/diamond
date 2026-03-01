# Building the Documentation Registry

Instead of a simple one-off crawler, we are building a **Latest Docs Registry**. Think of it like `brew` or `llmfit` for documentation. It manages a local collection of library docs and keeps them fresh for the AI.

## 1. The Core Objective
Build a central registry that "syncs" documentation for specific libraries, converts them to Markdown, and exposes them as a structured library of resources to any MCP-compatible AI.

## 2. Our MCP Server Structure

### A. Tools (Actions)
Our server will expose tools to manage the registry:
- **`sync_docs(lib: string, url: string, config?: { latest: boolean })`**
    - **What it does:** Ensures the local registry has the documentation for `lib`.
    - **Logic:** 
        - If `lib` is already synced and `latest: true` (and no new updates found), it does nothing.
        - If `lib` is new or needs update, it triggers the crawler.
- **`list_synced_libs()`**
    - **What it does:** Returns a list of all libraries currently managed by the registry.
- **`remove_lib(lib: string)`**
    - **What it does:** Deletes the local data for a library.

### B. Resources (Data)
The registry exposes the documentation as a structured hierarchy:
- **`docs://{lib}/{path}`**
    - **Example:** `docs://lexical/api/editors`
    - **What it returns:** The Markdown content for that specific page.
- **`registry://list`**
    - **What it returns:** A summary of all synced libraries and their last sync date.

### C. Prompts (Templates)
- **`library-expert(lib: string)`**
    - **What it does:** Loads the context for a specific library from the registry to help the model answer questions accurately.

## 3. The "Sync" Lifecycle

1. **User/AI Request:** "I need the latest Lexical React docs."
2. **Host:** Calls `sync_docs(lib="lexical", url="https://lexical.dev", config={latest: true})`.
3. **Server (Registry Manager):**
    - Checks the local manifest (e.g., `registry.json`).
    - If already present and fresh, returns "Already up to date."
    - If missing or stale:
        - Spawns the Crawler (Playwright).
        - Scrapes, converts HTML -> Markdown.
        - Updates the local store and manifest.
4. **Server:** Notifies the client that resources for `lexical` are now available/updated.

## 4. Implementation Priorities

- **The Registry Manifest:** A way to track what we have (e.g., a simple SQLite DB or `registry.json`).
- **The Crawler Service:** A robust, Playwright-based worker that handles the "dirty work" of scraping.
- **The MCP Interface:** The layer that translates the registry data into MCP Tools and Resources.

