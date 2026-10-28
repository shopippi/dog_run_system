import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 本番では Worker が /admin/ の下に配信する。開発中の API は wrangler dev(8787番)に転送する。
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:8787',
      '/admin/api': 'http://localhost:8787',
    },
  },
});
