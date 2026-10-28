import { execFileSync } from 'node:child_process';
import path from 'node:path';
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

/** ブラウザで大きな写真(JPEG)を作る。カメラで撮った写真の代わり。 */
export async function makePhoto(page: Page, width = 1600, height = 1200): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.fillStyle = '#c8a165';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#5a3d1e';
      g.beginPath();
      g.arc(w / 2, h / 2, Math.min(w, h) / 3, 0, Math.PI * 2);
      g.fill();
      return c.toDataURL('image/jpeg', 0.9);
    },
    [width, height] as const,
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/** 画面から初回登録をする(同意 → 犬の登録)。 */
export async function registerViaUi(page: Page, user: string, dogNames: string[] = ['アル']) {
  await openLiff(page, user);
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  for (const [i, name] of dogNames.entries()) {
    if (i > 0) await page.getByRole('button', { name: '＋ もう1頭追加する' }).click();
    const form = page.locator('fieldset.dog-form').nth(i);
    await form.getByLabel('名前').fill(name);
    await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'トイプードル' });
  }
  await page.getByRole('button', { name: '次へ' }).click();
  await answerSurvey(page);
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByText('登録が完了しました').waitFor();
  return (await page.locator('.welcome-card .id').textContent())!;
}

/** 登録のアンケートの必須の質問に答える。 */
export async function answerSurvey(page: Page) {
  await page.getByRole('heading', { name: 'かんたんなアンケート' }).waitFor();
  await page.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '30代' }).check();
  await page.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '女性' }).check();
  await page.getByRole('radiogroup', { name: /きっかけ/ }).getByRole('radio', { name: 'Instagram' }).check();
}

let cachedPassphrase: string | null = null;

/** 受付の固定QRコードの合言葉(テスト用のデータベースから読む) */
export function checkinPassphrase(): string {
  if (cachedPassphrase) return cachedPassphrase;
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/e2e', '--json', '--command',
      "SELECT value FROM settings WHERE key = 'checkin_passphrase'"],
    { cwd: path.resolve(__dirname, '../apps/api'), encoding: 'utf8' },
  );
  const rows = JSON.parse(out)[0].results as { value: string }[];
  cachedPassphrase = JSON.parse(rows[0]!.value) as string;
  return cachedPassphrase;
}

/** 受付のQRコードを読み取ったときと同じ URL を開く */
export async function openCheckin(page: Page, user: string) {
  await openLiff(page, user, `/checkin?k=${checkinPassphrase()}`);
}

/** 管理画面にログインする(e2e/start-server.sh で作ったアカウント) */
export async function adminLogin(page: Page, role: 'admin' | 'staff' | 'developer' = 'admin', path = '/') {
  await page.goto(`/admin${path}`);
  await page.getByLabel('メールアドレス').fill(`${role}@example.com`);
  await page.getByLabel('パスワード').fill('e2e-password-1234');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.getByRole('button', { name: 'ログアウト' }).waitFor();
}
