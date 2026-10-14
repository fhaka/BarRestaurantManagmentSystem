import { fileURLToPath } from 'node:url';
import { createLogger, defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// A page that navigates away resets its live-update socket; Vite logs that as a proxy error with
// a stack trace. It is normal, so those lines are dropped; every other message is kept.
const logger = createLogger();
const logError = logger.error.bind(logger);
logger.error = (message, options) => {
  if (/ws proxy (socket )?error/.test(message) && /ECONNRESET|ECONNABORTED|EPIPE/.test(message))
    return;
  logError(message, options);
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env.API_PORT || '4100';
  return {
    customLogger: logger,
    plugins: [react(), tailwindcss()],
    envDir: repoRoot,
    server: {
      port: Number(env.GUEST_PORT || 5181),
      strictPort: true,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
        '/socket.io': {
          target: `http://localhost:${apiPort}`,
          ws: true,
        },
        '/uploads': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    preview: { port: Number(env.GUEST_PORT || 5181) },
  };
});
