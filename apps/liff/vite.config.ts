import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 本番では Worker が /liff/ の下に配信する。開発中の API は wrangler dev(8787番)に転送する。
export default defineConfig({
  base: '/liff/',
  plugins: [react()],
  build: {
    rolldownOptions: {
      // 入力チェック(zod)の定義を、使わない画面のファイルに入れない(会員証の最初の読み込みを小さくする。要件定義書 15.3)。
      // - z.object(...) などは呼ぶだけでは何も起きないので、使われていなければ消してよい
      // - packages/shared の部品は、お客さん向けの画面では「読み込むだけで何かが起きる」ことに頼らない
      //   (操作ログの言葉を足す Object.assign は管理画面だけで使う)。使わない部品は丸ごと入れない
      treeshake: {
        manualPureFunctions: ['z'],
        moduleSideEffects: (id: string) => !/[\\/]packages[\\/]shared[\\/]src[\\/]/.test(id),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/admin/api': 'http://localhost:8787',
    },
  },
});
