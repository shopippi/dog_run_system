import { defineConfig, devices } from '@playwright/test';

// 複数の作業場所で同時に動かせるよう、ポートは E2E_PORT で変えられる(初期値 8788)
const PORT = Number(process.env.E2E_PORT ?? 8788);
// ブラウザだけで動くデモ(apps/demo)を配信するポート(初期値は E2E_PORT + 500)
const DEMO_PORT = Number(process.env.DEMO_PORT ?? PORT + 500);

// 画面の通し操作のテスト。LIFF はモック(VITE_LIFF_ID なし)で動かす。
// テストのたびに、空のデータベースで wrangler dev を起動する(e2e/start-server.sh)。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
  },
  projects: [
    // LINE の中で開く画面は、スマホの大きさで確かめる
    { name: 'liff', testMatch: /liff\..*\.spec\.ts/, use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    // 受付・管理画面は、タブレットの大きさで確かめる
    { name: 'admin', testMatch: /admin\..*\.spec\.ts/, use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
    // 文字と背景のコントラスト(お客さん向けと管理画面の両方。画面の大きさはテストの中で決める)
    { name: 'contrast', testMatch: /contrast.*\.spec\.ts/ },
    // ブラウザだけで動くデモ(静的なファイルだけで、API とデータベースもブラウザの中で動く)
    {
      name: 'demo',
      testMatch: /demo(\..+)?\.spec\.ts/,
      use: { baseURL: `http://localhost:${DEMO_PORT}`, viewport: { width: 1400, height: 1000 } },
    },
  ],
  webServer: [
    {
      command: 'bash e2e/start-server.sh',
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `pnpm --filter @dr/demo build && npx http-server apps/demo/dist -p ${DEMO_PORT} -s -c-1`,
      url: `http://localhost:${DEMO_PORT}/index.html`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
