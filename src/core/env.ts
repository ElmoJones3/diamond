/**
 * Env — a single source of truth for Diamond's filesystem layout.
 *
 * All paths follow the XDG Base Directory Specification
 * (https://specifications.freedesktop.org/basedir-spec/latest/), which is
 * the standard convention on Linux and macOS for where applications should
 * store their files. This keeps Diamond's data out of the home directory root
 * and makes it easy for users to find, backup, or delete Diamond's data.
 *
 * Default layout (when XDG env vars are not set):
 *
 *   ~/.config/diamond/
 *   └── registry.json          ← the manifest of all tracked libraries/repos
 *
 *   ~/.local/share/diamond/
 *   ├── store/                 ← content-addressable store (CAS)
 *   │   └── ab/                ←   first 2 hex chars of hash (sharding)
 *   │       └── abcdef1234...  ←   full SHA256 hash = file content
 *   └── storage/               ← versioned views (hardlinked from store)
 *       └── msw/
 *           ├── 2.12.10/       ←   pinned version
 *           │   └── api/...
 *           └── latest -> 2.12.10  ← symlink to most recent version
 *
 *   ~/.cache/diamond/
 *   └── temp-abcdef...         ← staging area for atomic writes to the store
 *
 * Overriding paths:
 *   Set XDG_DATA_HOME, XDG_CONFIG_HOME, or XDG_CACHE_HOME to relocate Diamond's
 *   data. For example, to store everything on an external drive:
 *     XDG_DATA_HOME=/Volumes/MyDrive/xdg diamond sync ...
 */

import os from 'node:os';
import path from 'node:path';

export const Env = {
  /**
   * Root for large persistent data (the CAS store and versioned storage).
   * Defaults to `~/.local/share/diamond`.
   */
  get dataDir() {
    return process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, 'diamond')
      : path.join(os.homedir(), '.local', 'share', 'diamond');
  },

  /**
   * Root for configuration files (the registry manifest).
   * Defaults to `~/.config/diamond`.
   */
  get configDir() {
    return process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, 'diamond')
      : path.join(os.homedir(), '.config', 'diamond');
  },

  /**
   * Root for ephemeral / re-generatable files (temp files during atomic writes).
   * Defaults to `~/.cache/diamond`.
   * Safe to delete without data loss — Diamond will recreate what it needs.
   */
  get cacheDir() {
    return process.env.XDG_CACHE_HOME
      ? path.join(process.env.XDG_CACHE_HOME, 'diamond')
      : path.join(os.homedir(), '.cache', 'diamond');
  },

  /**
   * The content-addressable store directory.
   *
   * Files here are addressed by their SHA256 hash and never mutated — writing
   * the same content twice is a no-op. The first two hex characters of the
   * hash are used as a subdirectory to avoid putting thousands of files in a
   * single flat directory (which is slow on many filesystems).
   *
   * Example path: `~/.local/share/diamond/store/ab/abcdef1234...`
   */
  get storeDir() {
    return path.join(this.dataDir, 'store');
  },

  /**
   * The versioned storage directory.
   *
   * This is the "project view" of Diamond's data: files are organized by
   * library and version, and each file is a hardlink into the CAS store.
   * Hardlinks mean the same content bytes are never duplicated on disk, even
   * when the same page appears in multiple library versions.
   *
   * Example path: `~/.local/share/diamond/storage/msw/2.12.10/api/handlers.md`
   */
  get storageDir() {
    return path.join(this.dataDir, 'storage');
  },

  /**
   * The path to the registry manifest JSON file.
   *
   * The registry is Diamond's index of everything it knows about — synced doc
   * libraries and local repositories. It is read on startup and updated after
   * every sync or repo registration.
   *
   * Example path: `~/.config/diamond/registry.json`
   */
  get registryPath() {
    return path.join(this.configDir, 'registry.json');
  },
} as const;
