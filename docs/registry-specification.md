# Registry Specification

This document defines how the Global Documentation Registry tracks, manages, and synchronizes library documentation across multiple versions and ecosystems.

## 1. Registry Entry Schema
Each entry in the registry represents either a documentation library (crawled) or a local repository (indexed).

### A. Documentation Type (`type: "docs"`)
```json
{
  "id": "msw",
  "type": "docs",
  "name": "Mock Service Worker",
  "homepage": "https://mswjs.io/",
  "config": {
    "syncStrategy": "registry",
    "registrySource": "npm",
    "packageName": "msw",
    "freshness": "1d"
  },
  "versions": {
    "2.12.10": {
      "path": "storage/msw/2.12.10",
      "syncedAt": "2024-05-20T10:00:00Z"
    }
  }
}
```

### B. Repository Type (`type: "repo"`)
```json
{
  "id": "diamond-core",
  "type": "repo",
  "name": "Diamond Core",
  "localPath": "/Users/sf/work/diamond",
  "config": {
    "syncStrategy": "git",
    "branch": "main",
    "autoPull": true
  },
  "syncedAt": "2024-05-20T10:00:00Z"
}
```

## 2. Sync Variants & Discovery

### A. Discovery Tools
- **`check_npm_version(package)`**: Returns latest version/URL from NPM.
- **`discover_local_repos(rootPath)`**: Scans `rootPath` for `.git` directories and returns potential repo entries.

### B. Sync Strategies
1. **Registry/Time-Based (`docs`)**: Re-crawl if a newer version exists or threshold is exceeded.
2. **Git-Based (`repo`)**: 
   - **Action**: Performs `git pull` in the `localPath`.
   - **Benefit**: No data duplication; respects local VCS state.

## 3. Storage Hierarchy
- **Docs**: CAS-based (Hardlinked from `$DATA_DIR/store` to `$DATA_DIR/storage`).
- **Repos**: Reference-only. The registry simply points to the original `localPath`.

## 4. Resource Addressing
- **Docs**: `docs://{lib}/{version}/{path}`
- **Repos**: `repo://{repo-id}/{path}` (e.g., `repo://diamond-core/src/index.ts`)

## 5. The Sync Algorithm (CAS-Enabled)

The `sync_docs` tool is a **blocking operation** that uses atomic ingestion:

1. **Resolve Intent:** The model calls `sync_docs` with a library and optional version/strategy.
2. **Discovery:** The server checks the external registry (e.g., NPM) for the latest version.
3. **Check Local State:**
   - If version already exists in `$DATA_DIR/storage/{lib}/{version}/`: **No-op**.
4. **Ingest (Atomic/CAS):**
   - Crawler (Playwright) fetches HTML and transforms it to Markdown.
   - For each page:
     - Calculate the **SHA256 hash** of the Markdown content.
     - If the hash DOES NOT exist in `$DATA_DIR/store/`: Save the file to the store.
     - Create a **hardlink** from the store to `$DATA_DIR/storage/{lib}/{version}/pages/{path}.md`.
   - Update `registry.json` and the version's `index.json`.
5. **Finalize:**
   - Update the `latest` symlink if necessary.
   - Return the list of new resource URIs.
