import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// デモ画面。静的なファイルだけで動くよう、相対パス(base: './')で出力する。
// apps/api のコード(createApp など)は @api-src から読む。
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@api-src': path.resolve(import.meta.dirname, '../api/src') },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5175,
    fs: { allow: [path.resolve(import.meta.dirname, '../..')] },
  },
  test: {
    environment: 'node',
    testTimeout: 30_000,
  },
});
