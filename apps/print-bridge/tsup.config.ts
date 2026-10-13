import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them in.
  noExternal: [/^@tavolina\//],
});
