import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makePhoto } from './helpers';

// ブラウザだけで動くデモ(apps/demo)。静的なファイルだけを配信し、API とデータベースはブラウザの中で動く。
// SQLite の本体(WASM)は CDN から読むが、テストでは手元のファイルを返す(ネットにつながらなくても動くよう)。
const WASM = fs.readFileSync(path.resolve(__dirname, '../apps/demo/node_modules/sql.js/dist/sql-wasm.wasm'));

test.beforeEach(async ({ context }) => {
  await context.route(/sql-wasm\.wasm$/, (route) =>
    route.fulfill({ body: WASM, contentType: 'application/wasm', headers: { 'access-control-allow-origin': '*' } }),
  );
});

const phone = (page: Page) => page.frameLocator('iframe[title="お客さんのスマホ"]');
const adminFrame = (page: Page) => page.frameLocator('iframe[title="受付・管理画面"]');

/**
 * スマホの画面の下に固定した帯(主ボタン)を押す。帯は iframe の中で固定されているため、
 * Playwright のスクロールではデモのページ側が動かない。先にスマホの枠の下端が見えるところまでページを動かす。
 */
async function barClick(page: Page, name: string) {
  await page.locator('iframe[title="お客さんのスマホ"]').evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await phone(page).locator('.action-bar').getByRole('button', { name, exact: true }).click();
}

async function openDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('heading', { name: '打ち合わせ用の手順' }).waitFor({ timeout: 30_000 });
  await adminFrame(page).getByRole('button', { name: 'ログアウト' }).waitFor();
}

async function scene(page: Page, n: number) {
  await page.getByRole('button', { name: new RegExp(`^${n}\\s`) }).click();
  await expect(page.getByTestId('scene-hint')).toContainText(`${n}.`);
}

test('手順1〜4: はじめての登録、9ポイントのおうちのチェックイン、家族の招待、同じ日の家族のチェックイン', async ({ page }) => {
  await openDemo(page);

  // 1 はじめてのお客さん: 受付の QR から開いて、写真つきで登録する
  await scene(page, 1);
  const p = phone(page);
  await expect(p.getByRole('heading', { name: 'はじめての方へ' })).toBeVisible();
  await p.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await barClick(page, '同意して次へ');
  const form = p.locator('fieldset.dog-form').first();
  await form.getByLabel('名前').fill('ポチ');
  await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: '柴犬' });
  await p.locator('input[type="file"]').first().setInputFiles({ name: 'dog.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page) });
  await expect(p.getByText('写真を撮り直す・選び直す')).toBeVisible();
  await barClick(page, '次へ');
  await p.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '30代' }).check();
  await p.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '女性' }).check();
  await p.getByRole('radiogroup', { name: /きっかけ/ }).getByRole('radio', { name: 'Instagram' }).check();
  await barClick(page, '登録する');
  await expect(p.getByText('登録が完了しました')).toBeVisible();
  await expect(p.getByText('DR-000031')).toBeVisible();
  await expect(page.getByTestId('who-note')).toContainText('ポチのおうち(DR-000031)');

  // 2 9ポイントのおうちがチェックイン: こむぎだけ選ぶと10ポイントになる(無料券への交換は会員証で押す)
  await scene(page, 2);
  await expect(page.getByTestId('who-note')).toContainText('9ポイント');
  await p.getByRole('checkbox', { name: /だいず/ }).uncheck();
  await barClick(page, 'チェックインする');
  await expect(p.getByRole('region', { name: 'チェックイン完了' })).toBeVisible();
  await expect(p.getByText(/会員証の「無料券と交換する」から、無料券と交換できます/)).toBeVisible();
  await expect(adminFrame(page).getByRole('listitem', { name: /こむぎ/ })).toBeVisible();

  // 3 ママがパパを招待: LINE のトークに届いた招待を、パパの LINE で開いて参加する
  await scene(page, 3);
  await p.getByRole('button', { name: 'LINEで招待を送る' }).click();
  await expect(page.getByRole('region', { name: 'LINE のトーク' })).toContainText('こむぎママさんから');
  await page.getByLabel('LINE のアカウント').selectOption({ label: 'こむぎパパ' });
  await page.getByRole('button', { name: 'この招待を開く(こむぎパパの LINE で)' }).click();
  await expect(p.getByRole('heading', { name: 'こむぎ・だいずのおうちに参加しますか?' })).toBeVisible();
  await p.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '40代' }).check();
  await p.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '男性' }).check();
  await p.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await barClick(page, '参加する');
  await expect(p.getByText('参加しました')).toBeVisible();

  // 4 パパも同じ日にチェックイン: ポイントは増えず、一緒に来た だいず を追加できる
  await scene(page, 4);
  await expect(p.getByText('今日はこむぎママさんがチェックイン済みです。')).toBeVisible();
  await barClick(page, 'ワンちゃんを追加する');
  await expect(p.getByRole('region', { name: 'チェックイン完了' })).toBeVisible();
  await expect(page.getByTestId('who-note')).toContainText('こむぎ・だいずのおうち(DR-000001)・10ポイント');
});

test('管理画面: ログイン・今日の来場・取り消し・製作者は見るだけ', async ({ page }) => {
  await openDemo(page);
  const a = adminFrame(page);

  // 管理画面の中で、ログアウトしてからログインし直す
  await a.getByRole('button', { name: 'ログアウト' }).click();
  await a.getByLabel('メールアドレス').fill('staff@example.com');
  await a.getByLabel('パスワード').fill('demo-password-1234');
  await a.getByRole('button', { name: 'ログイン' }).click();
  await expect(a.getByRole('button', { name: 'ログアウト' })).toBeVisible();
  await expect(a.getByRole('heading', { name: '今日の来場' })).toBeVisible();

  // お客さんがチェックインすると、今日の来場に出る
  await scene(page, 2);
  await barClick(page, 'チェックインする');
  await expect(phone(page).getByRole('region', { name: 'チェックイン完了' })).toBeVisible();

  // 受付スタッフで取り消す
  await page.getByRole('button', { name: '受付スタッフ', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('受付スタッフの佐藤さんとしてログインしました');
  const row = a.getByRole('listitem', { name: /こむぎ/ });
  const confirm = a.getByRole('dialog', { name: 'チェックインを取り消す' });
  // ログインを切り替えた直後は管理画面が読み込み直され、開いたダイアログが閉じることがある。取り消しが済むまでやり直す
  const cancelled = row.getByText('取り消し済み(二重のチェックイン)');
  await expect(async () => {
    if (await cancelled.isVisible()) return;
    if (!(await confirm.isVisible())) await row.getByRole('button', { name: '取り消す' }).click({ timeout: 3000 });
    await confirm.getByRole('radio', { name: '二重のチェックイン' }).check({ timeout: 3000 });
    await confirm.getByRole('button', { name: '取り消す' }).click({ timeout: 3000 });
    await expect(cancelled).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 25_000 });

  // お客さんの会員証は 9 ポイントに戻る
  await page.getByRole('button', { name: 'リッチメニューから開く' }).click();
  await expect(phone(page).getByRole('img', { name: 'ポイント 9 / 10' })).toBeVisible();

  // 製作者は見るだけ(取り消しのボタンが出ない)
  await page.getByRole('button', { name: '製作者', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('製作者の山本さんとしてログインしました');
  await expect(a.getByText('山本')).toBeVisible();
  await expect(a.getByRole('listitem').first()).toBeVisible();
  await expect(a.getByRole('button', { name: '取り消す' })).toHaveCount(0);
});

test('再読み込みしても続きから使え、「翌日にする」と「最初からやり直す」が効く', async ({ page }) => {
  await openDemo(page);
  await scene(page, 2);
  await barClick(page, 'チェックインする');
  await expect(phone(page).getByRole('region', { name: 'チェックイン完了' })).toBeVisible();

  await page.reload();
  await page.getByRole('heading', { name: '打ち合わせ用の手順' }).waitFor();
  await expect(page.getByTestId('who-note')).toContainText('10ポイント');

  const today = await page.getByTestId('demo-today').textContent();
  await page.getByRole('button', { name: '翌日にする' }).click();
  await expect(page.getByTestId('demo-today')).not.toHaveText(today!);
  await scene(page, 2);
  await expect(phone(page).getByRole('button', { name: 'チェックインする' })).toBeVisible();

  await page.getByRole('button', { name: '夜間の処理を今すぐ動かす' }).click();
  await expect(page.getByRole('status')).toContainText('夜間の処理');

  await page.getByRole('button', { name: '最初からやり直す' }).click();
  await page.getByRole('dialog', { name: '最初からやり直す' }).getByRole('button', { name: 'やり直す' }).click();
  await expect(page.getByRole('status')).toContainText('最初の状態に戻しました', { timeout: 30_000 });
  await expect(page.getByTestId('demo-today')).toHaveText(today!);
  await expect(page.getByTestId('who-note')).toContainText('9ポイント');
});

test('管理画面: 写真は API から読んでから出し(404 にならない)、システムの状態は天気・祝日もふくめて正常', async ({ page }) => {
  const notFound: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404 && /\/api\/media\//.test(r.url())) notFound.push(r.url());
  });
  await openDemo(page);
  const a = adminFrame(page);

  // おうちの詳細の犬の写真は blob: の URL で出る
  await scene(page, 6);
  const photo = a.locator('img.av').first();
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute('src', /^blob:/);
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // 旧カードの引き継ぎ(受付で直接入力)の画面を開いても、写真の読み込みで 404 にならない
  await scene(page, 7);
  expect(notFound).toEqual([]);

  // システムの状態: 初期データに実行の履歴があり、すべて緑。天気は外につながずにスキップして成功にする
  await a.getByRole('link', { name: 'システムの状態' }).click();
  const list = a.getByRole('region', { name: '自動で動く処理' });
  await expect(list.getByRole('listitem', { name: '天気の取得 正常' })).toBeVisible();
  await expect(list.getByRole('listitem', { name: '祝日の取り込み 正常' })).toBeVisible();
  await expect(a.getByRole('alert')).toHaveCount(0);
  const weather = list.getByRole('listitem', { name: /天気の取得/ });
  await weather.getByRole('button', { name: '今すぐ実行' }).click();
  // 結果は右下のトースト(お知らせ)に出る
  await expect(a.locator('.toasts [role="status"]').filter({ hasText: '天気の取得' })).toContainText('スキップしました(インターネットにつながらない環境のため)。');
  await expect(list.getByRole('listitem', { name: '天気の取得 正常' })).toBeVisible();
});

test('LINE のトーク画面: リッチメニューから会員証・来場の記録・チェックインを開き、× でトークに戻る', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'LINE のトーク画面' }).click();
  const talk = page.getByRole('region', { name: 'LINE のトーク画面' });
  await expect(talk.getByText('友だち追加ありがとうございます')).toBeVisible();
  const menu = talk.getByRole('group', { name: 'リッチメニュー' });
  await expect(menu.locator('img')).toBeVisible();
  if (process.env.SHOT_DIR) await page.locator('.phone').screenshot({ path: `${process.env.SHOT_DIR}/LINE のトーク画面.png` });

  await menu.getByRole('button', { name: 'リッチメニューの「会員証」' }).click();
  await expect(phone(page).getByText('グリーンドーム 会員証').first()).toBeVisible();
  await page.getByRole('button', { name: '閉じて LINE のトークに戻る' }).click();
  await expect(talk).toBeVisible();

  await menu.getByRole('button', { name: 'リッチメニューの「来場の記録」' }).click();
  await expect(phone(page).getByRole('heading', { name: '来場履歴' })).toBeVisible();
  await page.getByRole('button', { name: '閉じて LINE のトークに戻る' }).click();

  // チェックインは、受付の QR を読み取ったことにして開く
  await menu.getByRole('button', { name: 'リッチメニューの「チェックイン」' }).click();
  await expect(phone(page).getByRole('button', { name: 'チェックインする' })).toBeVisible();
});

test('手順9: 予約(はじめての子は確認待ち → 管理者が承認 → 確定。LINE のトークに確定のお知らせ。満員・休みの日は選べない)', async ({ page }) => {
  await openDemo(page);
  await scene(page, 9);
  const p = phone(page);
  await expect(p.getByRole('heading', { name: '預かり・お泊まりの予約' })).toBeVisible();
  await p.getByRole('button', { name: '予約する' }).click();
  await p.getByRole('checkbox', { name: /だいず/ }).check();
  await expect(p.getByText('はじめての子がいるので、お店が確認してから確定します。')).toBeVisible();
  await barClick(page, '日にちを選ぶ');
  await expect(p.locator('.bk-cal')).toHaveAttribute('aria-busy', 'false');
  // 6日後は中型が満員、9日後は休み(初期データ)
  const day = (n: number) => {
    const t = new Date(Date.now() + 9 * 3600_000);
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + n)).toISOString().slice(0, 10);
  };
  const cell = (n: number) => p.locator(`.bk-cal-cell[data-date="${day(n)}"]`);
  for (const n of [6, 9, 3]) {
    if ((await cell(n).count()) === 0) await p.getByRole('button', { name: '次の月' }).click();
    await expect(p.locator('.bk-cal')).toHaveAttribute('aria-busy', 'false');
    if (n === 6) await expect(cell(6)).toHaveAttribute('data-status', 'full');
    if (n === 9) await expect(cell(9)).toHaveAttribute('data-status', 'closed');
    if (n === 3) {
      if ((await cell(3).count()) === 0) await p.getByRole('button', { name: '前の月' }).click();
      await cell(3).click();
    }
  }
  await barClick(page, '次へ');
  for (const box of await p.locator('.bk-check input[type=checkbox]').all()) await box.check();
  await barClick(page, '内容を確かめる');
  await expect(p.getByRole('region', { name: '料金の目安' })).toContainText('4,000円');
  await barClick(page, '予約する');
  await expect(p.locator('.bk-detail-title .badge')).toHaveText('確認待ち');

  // 管理者が確認待ちから承認する
  const a = adminFrame(page);
  await a.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: /^予約/ }).click();
  await a.getByRole('heading', { name: '予約カレンダー' }).waitFor();
  await a.getByRole('link', { name: /^確認待ち \d+件/ }).click();
  await a.getByRole('button', { name: /こむぎ・だいずのおうち/ }).first().click();
  const dialog = a.getByRole('dialog', { name: '預かりの予約' });
  await dialog.getByRole('button', { name: '承認する' }).click();
  await dialog.getByRole('button', { name: '承認する' }).click();
  await expect(dialog.locator('.badge').first()).toHaveText('確定');

  // お客さんの画面が確定になり、LINE のトークに確定のお知らせが出る
  await page.getByRole('button', { name: 'リッチメニューから開く' }).click();
  await p.getByRole('link', { name: '預かり・お泊まりの予約' }).click();
  await expect(p.getByRole('region', { name: 'これからの予約' })).toContainText('だいず');
  await expect(p.getByRole('region', { name: 'これからの予約' }).getByRole('link', { name: /だいず/ })).toContainText('確定');
  await page.getByRole('button', { name: 'LINE のトーク画面' }).click();
  await expect(page.getByTestId('booking-notice').last()).toContainText('預かりのご予約が確定しました');
  await expect(page.getByTestId('booking-notice').last()).toContainText('デモでは実際には送りません');
});
