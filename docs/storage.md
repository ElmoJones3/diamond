# Storage System

Diamond's storage is built around two ideas: content-addressable storage (CAS) for deduplication, and a human-navigable versioned directory structure for the MCP server to read from.

## On-Disk Layout

```
~/.config/diamond/
└── registry.json                    ← manifest of all tracked libraries/repos

~/.local/share/diamond/
├── store/                           ← content-addressable store (CAS)
│   └── ab/                          ←   first 2 hex chars of hash (sharding)
│       └── abcdef1234...            ←   full SHA256 hash = file name = content
└── storage/                         ← versioned views (human-navigable)
    └── msw/
        ├── 2.12.10/                 ←   pinned version directory
        │   ├── api/
        │   │   └── handlers.md     ←   hardlink → store/ab/abcdef...
        │   ├── getting-started.md
        │   └── search-index.json   ←   MiniSearch index for this version
        └── latest -> 2.12.10        ←   symlink to most recent version

~/.cache/diamond/
└── temp-abcdef...                   ← staging area for atomic CAS writes
```

All paths are XDG-compliant and can be overridden with `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME`.

## Content-Addressable Store (`CasStore`)

The CAS is an append-only object store where the address of every file is its SHA256 hash. This gives two guarantees:

1. **Deduplication** — the same content is stored exactly once, no matter how many libraries or versions reference it.
2. **Integrity** — content can be verified at any time by re-hashing.

### Write path (atomic)
```
content → SHA256 → hash
if store/ab/hash doesn't exist:
  write content → cache/temp-{hash}   (safe: partial writes go here)
  rename temp → store/ab/{hash}       (atomic on POSIX: rename is all-or-nothing)
return hash
```

The temp → rename pattern ensures the store never contains a partially-written file, even if Diamond crashes mid-write.

### Sharding
Files are stored under a two-character subdirectory (`store/ab/abcdef...`). This is the same approach Git and npm use to prevent any single directory from accumulating too many entries, which degrades performance on most filesystems beyond ~10,000 files.

## Versioned Storage (`StorageManager`)

`StorageManager` creates a "project view" of the CAS: a directory tree organised by library and version where each file is a hardlink into the store.

### Hardlinks vs copies
A hardlink is a second directory entry pointing to the same inode (the same bytes on disk). Diamond uses hardlinks so:
- Reading `storage/msw/2.12.10/api/handlers.md` reads directly from the store — no copy.
- Deleting a versioned directory doesn't affect the CAS; the inode is only freed when all hardlinks to it are gone.
- Identical pages across versions literally share the same disk blocks.

### The `latest` symlink
After writing a versioned directory, `StorageManager` updates a `latest` symlink to point at it:
```
storage/msw/latest -> 2.12.10
```
This lets the MCP server serve `docs://msw/latest/api/handlers` without knowing the current version number, and makes the "current" version a single atomic symlink swap.

## Registry (`RegistryManager`)

The registry is a single `registry.json` file that tracks everything Diamond knows about:

```json
{
  "msw": {
    "id": "msw",
    "type": "docs",
    "name": "msw",
    "homepage": "https://mswjs.io/docs",
    "versions": {
      "2.12.10": { "syncedAt": "2024-05-20T10:00:00Z" }
    }
  },
  "diamond-core": {
    "id": "diamond-core",
    "type": "repo",
    "name": "diamond-core",
    "localPath": "/Users/sf/work/diamond",
    "config": { "syncStrategy": "git", "autoPull": true },
    "syncedAt": "2024-05-20T10:00:00Z"
  }
}
```

The file is validated against a Zod schema on load. All writes serialize the entire in-memory Map — the file is small enough that this is always fast.

## Search Index (`SearchService`)

Each synced version gets a MiniSearch index stored alongside its Markdown files:

```
storage/msw/2.12.10/search-index.json
```

The index is built at sync time and loaded on demand at search time. It is not kept in memory between calls — each `search()` call deserializes the JSON and runs the query. For the sizes of documentation libraries this targets, this is fast enough and keeps the server's memory footprint minimal.

MiniSearch configuration:
- Indexed fields: `title`, `content`
- Stored fields: `title`, `url` (returned with results; not re-parsed from files)
- Search options: prefix matching, 20% fuzzy tolerance, 2× title boost
