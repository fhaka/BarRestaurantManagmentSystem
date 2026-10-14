import { defineConfig } from 'tsup';

export default defineConfig({
  // The server, plus the database CLI with its migrations and seeds, so a production image can
  // migrate (and load the demo) with plain node: node dist/db/cli.js migrate.
  entry: ['src/server.ts', 'src/db/cli.ts', 'src/db/migrations/*.ts', 'src/db/seeds/*.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them into the API build.
  noExternal: [/^@tavolina\//],
});
