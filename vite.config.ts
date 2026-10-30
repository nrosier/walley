import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => {
  const raw = loadEnv(mode, process.cwd(), '').PORT ?? process.env.PORT;
  const apiPort = raw !== undefined && /^\d+$/.test(raw) ? raw : '3000';

  return {
    root: fileURLToPath(new URL('./src/web', import.meta.url)),
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/web', import.meta.url)),
      },
    },
    build: {
      outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      host: '127.0.0.1',
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:' + apiPort,
        },
      },
    },
  };
});
