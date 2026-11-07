import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@ptext/core': r('./packages/core/src/index.ts'),
      '@ptext/mcp': r('./packages/mcp/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'examples/*/test/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
