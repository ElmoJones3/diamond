# Registry Specification

This document defines how the Global Documentation Registry tracks, manages, and synchronizes library documentation across multiple versions and ecosystems.

## 1. Registry Entry Schema
Each entry in the registry represents a library and its collection of synced versions.

```json
{
  "id": "msw",
  "name": "Mock Service Worker",
  "homepage": "https://mswjs.io/",
  "config": {
    "syncStrategy": "registry",
    "registrySource": "npm",
    "packageName": "msw",
    "freshness": "1d"
  },
  "versions": {
    "1.3.2": {
      "path": "storage/msw/1.3.2",
      "syncedAt": "2023-11-10T10:00:00Z"
    },
    "2.12.10": {
      "path": "storage/msw/2.12.10",
      "syncedAt": "2024-05-20T10:00:00Z"
    }
  }
}
```

## 2. Sync Variants & Discovery

The `sync_docs` tool handles the core logic, but we also expose **Discovery Tools** to help the model decide on a strategy.

### A. Discovery Tools
- **`check_npm_version(package: string)`**: Returns the latest version and documentation URL from the NPM registry.
- **`check_go_version(module: string)`**: Returns the latest version and documentation URL for a Go module.
- **`check_pypi_version(package: string)`**: (Future) Returns latest Python package info.

### B. Sync Strategies
1. **Registry-Based (`registry`)**
   - **Logic:** Uses Discovery Tools to check if a newer version exists in the ecosystem.
   - **Action:** If `latestVersion > currentLocalVersion`, trigger a sync for the new version.
2. **Time-Based (`time`)**
   - **Logic:** Fallback for docs without a package registry. Compares `syncedAt` with current time.
   - **Action:** Re-crawl the URL if the threshold (e.g., 7 days) is exceeded.

## 3. Storage Hierarchy (XDG Compliant & CAS-Based)
We follow XDG standards for local storage. To ensure extreme efficiency, we use a **Content-Addressable Store (CAS)** and **Hardlinks**, similar to `pnpm`.

- **Data/Docs Base:** `~/.local/share/mcp-docs/` (referred to as `$DATA_DIR`)
- **Config:** `~/.config/mcp-docs/registry.json`
- **Cache:** `~/.cache/mcp-docs/`

```text
$DATA_DIR/
├── store/                 # Global Content-Addressable Store (CAS)
│   └── {sha256}/          # Files indexed by content hash
└── storage/               # The "Project" view (Hardlinked/Symlinked)
    └── {lib-id}/
        ├── {version}/     # Collection of HARDLINKS to store/
        │   ├── index.json # Page manifest (titles, paths, hashes)
        │   └── pages/     # The actual .md files (hardlinked)
        └── latest/        # SYMLINK to the highest version
```

## 4. Resource Addressing
Resources are exposed to the AI using a version-aware URI scheme:

- **`docs://{lib}/{version}/{path}`** (e.g., `docs://msw/2.12.10/api/setup`)
- **`docs://{lib}/latest/{path}`** (Convenience alias via symlink)

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
