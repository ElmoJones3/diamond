/**
 * RegistryManager — Diamond's manifest of everything it knows about.
 *
 * The registry is a single JSON file (`registry.json`, stored in the XDG
 * config directory) that tracks two kinds of entries:
 *
 *   • `docs` entries  — documentation libraries that have been crawled and
 *     stored locally. Each entry records the library's name, homepage, and a
 *     map of synced versions with their sync timestamps.
 *
 *   • `repo` entries  — local git repositories that Diamond has indexed.
 *     These are reference-only: Diamond just stores the path and sync config;
 *     the actual files live in the original checkout and are read directly.
 *
 * The registry uses Zod for schema validation on load, so corrupted or
 * hand-edited JSON produces a clear error rather than a confusing runtime
 * crash deep in the application.
 *
 * All writes go through `save()`, which serializes the in-memory Map back to
 * JSON atomically (via fs-extra's `writeJson`). The registry is small enough
 * that writing the entire file on every change is fast and simple.
 */

import fs from 'fs-extra';
import { z } from 'zod';
import { Env } from './env.js';

// ---------------------------------------------------------------------------
// Schema
//
// We use a Zod discriminated union keyed on `type` — Zod will pick the right
// schema based on whether `type` is "docs" or "repo", and give precise error
// messages if fields are wrong or missing.
// ---------------------------------------------------------------------------

export const RegistryEntrySchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('docs'),
    name: z.string(),
    homepage: z.string().optional(),
    /**
     * A map of version string → sync metadata.
     * The keys are semver strings (e.g. "2.12.10") or "latest".
     * The value records when that version was last synced.
     */
    versions: z.record(
      z.string(),
      z.object({
        syncedAt: z.string(), // ISO 8601 timestamp
      }),
    ),
  }),
  z.object({
    id: z.string(),
    type: z.literal('repo'),
    name: z.string(),
    /** Absolute path to the repository on the local filesystem. */
    localPath: z.string(),
    config: z.object({
      syncStrategy: z.literal('git'),
      /** The branch to pull from when auto-syncing. */
      branch: z.string().optional(),
      /** Whether to run `git pull` automatically before serving files. */
      autoPull: z.boolean().default(true),
    }),
    syncedAt: z.string(), // ISO 8601 timestamp
  }),
]);

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export class RegistryManager {
  // Entries are keyed by their `id` for O(1) lookup. The in-memory store is
  // populated lazily by `init()` and kept in sync by `save()`.
  private entries: Map<string, RegistryEntry> = new Map();

  /**
   * Load the registry from disk into memory.
   *
   * Safe to call multiple times — if the registry file doesn't exist yet
   * (first run), the manager starts empty. If parsing fails, the error is
   * logged and the manager starts empty rather than crashing.
   *
   * Call this before any read or write operation that depends on up-to-date
   * registry state.
   */
  async init() {
    if (await fs.pathExists(Env.registryPath)) {
      try {
        const data = await fs.readJson(Env.registryPath);
        // Validate the entire file as a record of id → entry.
        // Zod throws a descriptive error if any entry doesn't match the schema.
        const parsed = z.record(z.string(), RegistryEntrySchema).parse(data);
        this.entries = new Map(Object.entries(parsed));
      } catch (e) {
        console.error('Failed to parse registry.json:', e);
      }
    }
  }

  /**
   * Persist the current in-memory registry to disk.
   *
   * Serializes the Map to a plain object (since JSON doesn't support Maps)
   * and writes it as pretty-printed JSON for human readability.
   */
  async save() {
    await fs.ensureDir(Env.configDir);
    const obj = Object.fromEntries(this.entries);
    await fs.writeJson(Env.registryPath, obj, { spaces: 2 });
  }

  /** Look up a single registry entry by its id. Returns undefined if not found. */
  getEntry(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  /** Return all registry entries as a flat array. */
  listEntries(): RegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Add or replace an entry in the registry and immediately persist to disk.
   *
   * If an entry with the same `id` already exists, it is overwritten — this
   * is the intended behavior for re-syncing an existing library.
   */
  async addEntry(entry: RegistryEntry) {
    this.entries.set(entry.id, entry);
    await this.save();
  }

  /** Remove an entry by id and persist the change to disk. */
  async removeEntry(id: string) {
    this.entries.delete(id);
    await this.save();
  }
}
