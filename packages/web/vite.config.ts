import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pwaBuild } from './src/lib/pwa-build';

export default defineConfig({
  plugins: [react(), pwaBuild()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:3000', '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
});
