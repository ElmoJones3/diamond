import fs from 'fs-extra';
import { z } from 'zod';
import { Env } from './env.js';

/**
 * Zod schemas for the Registry manifest.
 */
export const RegistryEntrySchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('docs'),
    name: z.string(),
    homepage: z.string().optional(),
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
    config: z.object({
      syncStrategy: z.literal('git'),
      branch: z.string().optional(),
      autoPull: z.boolean().default(true),
    }),
    syncedAt: z.string(),
  }),
]);

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

/**
 * Manages the 'registry.json' manifest for Diamond.
 */
export class RegistryManager {
  private entries: Map<string, RegistryEntry> = new Map();

  async init() {
    if (await fs.pathExists(Env.registryPath)) {
      try {
        const data = await fs.readJson(Env.registryPath);
        const parsed = z.record(z.string(), RegistryEntrySchema).parse(data);
        this.entries = new Map(Object.entries(parsed));
      } catch (e) {
        console.error('Failed to parse registry.json:', e);
      }
    }
  }

  async save() {
    await fs.ensureDir(Env.configDir);
    const obj = Object.fromEntries(this.entries);
    await fs.writeJson(Env.registryPath, obj, { spaces: 2 });
  }

  getEntry(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  listEntries(): RegistryEntry[] {
    return Array.from(this.entries.values());
  }

  async addEntry(entry: RegistryEntry) {
    this.entries.set(entry.id, entry);
    await this.save();
  }

  async removeEntry(id: string) {
    this.entries.delete(id);
    await this.save();
  }
}
