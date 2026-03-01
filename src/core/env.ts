import os from 'node:os';
import path from 'node:path';

/**
 * Manages XDG-compliant paths for Diamond's global state.
 */
export class Env {
  static get dataDir() {
    return process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, 'diamond')
      : path.join(os.homedir(), '.local', 'share', 'diamond');
  }

  static get configDir() {
    return process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, 'diamond')
      : path.join(os.homedir(), '.config', 'diamond');
  }

  static get cacheDir() {
    return process.env.XDG_CACHE_HOME
      ? path.join(process.env.XDG_CACHE_HOME, 'diamond')
      : path.join(os.homedir(), '.cache', 'diamond');
  }

  static get storeDir() {
    return path.join(Env.dataDir, 'store');
  }

  static get storageDir() {
    return path.join(Env.dataDir, 'storage');
  }

  static get registryPath() {
    return path.join(Env.configDir, 'registry.json');
  }
}
