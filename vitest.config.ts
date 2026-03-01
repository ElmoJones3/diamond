import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '#src': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
  },
});
