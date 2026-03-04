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
import { Env } from '#src/core/env.js';
import { getLogger } from '#src/logger.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const RegistryEntrySchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('docs'),
    name: z.string(),
    homepage: z.string().optional(),
    description: z.string().optional(),
    versions: z.record(
      z.string(),
      z.object({
        syncedAt: z.string(),
      }),
    ),
  }),
  z.object({
    id: z.string(),
    type: z.literal('repo'),
    name: z.string(),
    localPath: z.string(),
    description: z.string().optional(),
    config: z.object({
      syncStrategy: z.literal('git'),
      branch: z.string().optional(),
      autoPull: z.boolean().default(true),
    }),
    syncedAt: z.string(),
  }),
]);

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export class RegistryManager {
  private entries: Map<string, RegistryEntry> = new Map();

  /**
   * Load the registry from disk into memory.
   *
   * Safe to call multiple times — if the registry file doesn't exist yet
   * (first run), the manager starts empty. If parsing fails, the error is
   * logged and the manager starts empty rather than crashing.
   */
  async init() {
    const log = getLogger().child({ component: 'core:RegistryManager' });

    if (await fs.pathExists(Env.registryPath)) {
      try {
        const data = await fs.readJson(Env.registryPath);
        const parsed = z.record(z.string(), RegistryEntrySchema).parse(data);
        this.entries = new Map(Object.entries(parsed));
        log.debug({ entryCount: this.entries.size }, 'registry:loaded');
      } catch (e) {
        log.error({ err: e }, 'registry:parse_fail');
      }
    }
  }

  /**
   * Persist the current in-memory registry to disk.
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
