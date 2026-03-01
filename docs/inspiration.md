# Inspiration: The pnpm Model

This document explores how we can apply the core architectural innovations of `pnpm` to our Documentation Registry to achieve extreme efficiency in storage and speed.

## 1. Content-Addressable Storage (CAS)
**The Concept:** `pnpm` doesn't store packages; it stores *files* indexed by their content hash (SHA).
- **Application to Docs:** If `react@18.1` and `react@18.2` have 90% identical documentation pages, we should only store one physical copy of those 90 Markdown files.
- **The Registry Manifest:** Our `registry.json` or `index.json` for a library version wouldn't point to a file on disk, but to a content hash.
- **Benefit:** Massive disk savings when tracking multiple versions of a large library.

## 2. Hardlinks for "Zero-Copy" Registry
**The Concept:** `pnpm` uses hardlinks from a global content-addressable store into a project's `node_modules`.
- **Application to Docs:** When we "sync" a new version of a library, if a page's hash already exists in our global `$DATA_DIR/store`, we simply create a hardlink in `$DATA_DIR/storage/{lib}/{version}/{path}.md`.
- **Benefit:** Updates are nearly instantaneous. "Downloading" a new documentation version that only has 5 changed pages means we only write 5 new files to disk; the rest are linked from the store.

## 3. Symlinks for "Latest" Alias
**The Concept:** `pnpm` uses symlinks to create the directory structure and manage dependencies.
- **Application to Docs:** We can use a symlink for the `latest` version of a library.
- **Pathing:** `$DATA_DIR/storage/{lib}/latest` -> `$DATA_DIR/storage/{lib}/2.12.10/`.
- **Benefit:** Easy resource addressing (`docs://msw/latest/...`) without duplicating data or complex logic in the MCP server.

## 4. Atomic Syncing (The pnpm "Store")
**The Concept:** `pnpm` only downloads what it doesn't already have in the store.
- **Application to Docs:** When `sync_docs` runs, the crawler can first do a HEAD request or check a sitemap for hashes/last-modified dates. It only "ingests" (crawls/converts) the pages that are actually new.
- **Benefit:** Significant bandwidth savings and faster sync times for large documentation sites.

## 5. Non-Flat Structure (Isolation)
**The Concept:** `pnpm` prevents "phantom dependencies" by using a strict, nested symlink structure.
- **Application to Docs:** We should ensure each version of a library's documentation is strictly isolated in its own directory. This prevents one version from accidentally referencing assets or pages from another version.

---

### Revised Storage Strategy (pnpm-inspired)

```text
$DATA_DIR/
├── store/                 # Global Content-Addressable Store (CAS)
│   ├── sha256/
│   │   ├── ab/
│   │   │   └── cd123...   # The actual Markdown content
│   │   └── ef/
│   │       └── gh456...
└── storage/               # The "Project" view (hardlinked/symlinked)
    └── msw/
        ├── 1.3.2/         # Collection of hardlinks to store/
        ├── 2.12.10/       # Collection of hardlinks to store/
        └── latest/        # Symlink to 2.12.10/
```
