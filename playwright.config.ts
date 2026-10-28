import { defineConfig, devices } from '@playwright/test';

// 画面の通し操作のテスト。LIFF はモック(VITE_LIFF_ID なし)で動かす。
// テストのたびに、空のデータベースで wrangler dev を起動する(e2e/start-server.sh)。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8788',
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
    { name: 'contrast', testMatch: /contrast\.spec\.ts/ },
  ],
  webServer: {
    command: 'bash e2e/start-server.sh',
    url: 'http://localhost:8788/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
