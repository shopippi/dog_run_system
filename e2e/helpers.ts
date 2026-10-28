import type { Page } from '@playwright/test';

let seq = 0;

/** テストごとに別の LINE ユーザーを作る(データベースはテスト全体で共有するため)。 */
export function newLineUser(name: string): string {
  seq += 1;
  return `Ue2e${Date.now().toString(36)}${seq}:${name}`;
}

/** LIFF 画面を、指定した LINE ユーザーとして開く(LIFF はモック)。 */
export async function openLiff(page: Page, user: string, path = '/') {
  await page.goto(`/liff${path}${path.includes('?') ? '&' : '?'}mockUser=${encodeURIComponent(user)}`);
}
