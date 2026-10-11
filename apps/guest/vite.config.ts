import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env.API_PORT || '4100';
  return {
    plugins: [react()],
    envDir: repoRoot,
    server: {
      port: Number(env.GUEST_PORT || 5181),
      strictPort: true,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
        '/socket.io': { target: `http://localhost:${apiPort}`, ws: true },
        '/uploads': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    preview: { port: Number(env.GUEST_PORT || 5181) },
  };
});
