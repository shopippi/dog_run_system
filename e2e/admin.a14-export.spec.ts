import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { adminLogin, adminToast, newLineUser, registerViaUi } from './helpers';

// A-14 CSV出力(M-18)

test('A-14 種類を選んでダウンロードすると、BOM つきの日本語の見出しの CSV が保存される', async ({ browser }) => {
  const customer = await browser.newPage();
  await registerViaUi(customer, newLineUser('パパ'), ['チョコ']);
  await customer.close();

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await adminLogin(page, 'admin', '/export');
  const panel = page.getByRole('region', { name: 'CSVを作る' });
  await expect(panel.getByRole('radiogroup', { name: '出す内容' })).toBeVisible();
  await panel.getByRole('radio', { name: 'ワンちゃん' }).check();
  await expect(panel.getByLabel('期間の始め')).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'ダウンロード' }).click()]);
  // ファイル名(日本語)は画面の案内で確かめる。ヘッドレスの Chromium は日本語のファイル名を "download" にしてしまうため
  await expect(adminToast(page, /^「ワンちゃん_\d{4}-\d{2}-\d{2}\.csv」をダウンロードしました。$/)).toBeVisible();
  const bytes = await readFile((await dl.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString('utf8').slice(1);
  // 先頭は「#」の説明行。表は説明行のあとの見出しから
  expect(text.split('\r\n')[0]).toBe('# グリーンドーム ワンちゃん(CSV)');
  expect(text.split('\r\n').find((l) => !l.startsWith('#'))).toBe('犬ID,会員ID,おうちの呼び名,名前,犬種,サイズ,性別,生まれた年月,状態,写真,登録日時,来場回数(回),体重(kg),ほかの犬との相性,狂犬病の予防注射の年,混合ワクチンの年');
  expect(text).toContain(',チョコ,プードル,小型,');

  // 来場は期間を選べる。終わりが始めより前なら、直し方を出す
  await panel.getByRole('radio', { name: '来場' }).check();
  await panel.getByLabel('期間の始め').fill('2026-10-10');
  await panel.getByLabel('期間の終わり').fill('2026-10-01');
  await panel.getByRole('button', { name: 'ダウンロード' }).click();
  await expect(panel.getByRole('alert')).toContainText('期間の終わりの日は、始めの日より後にしてください。');
  await panel.getByLabel('期間の終わり').fill('2026-10-31');
  const [dl2] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'ダウンロード' }).click()]);
  expect((await readFile((await dl2.path())!)).toString('utf8').slice(1).split('\r\n').find((l) => !l.startsWith('#'))).toMatch(/^来場日,時刻,会員ID/);
  await expect(adminToast(page, /^「来場_2026-10-10〜2026-10-31_\d{4}-\d{2}-\d{2}\.csv」をダウンロードしました。$/)).toBeVisible();
  await page.close();
});

test('A-14 受付スタッフには CSV出力の画面がなく、開いても出力できない', async ({ page }) => {
  await adminLogin(page, 'staff');
  await expect(page.getByRole('link', { name: 'CSV出力' })).toHaveCount(0);
  await page.goto('/admin/export');
  await page.getByRole('radio', { name: 'おうち', exact: true }).check();
  await page.getByRole('button', { name: 'ダウンロード' }).click();
  await expect(page.getByRole('alert')).toContainText('この操作をする権限がありません');
});

test('A-14 AIに渡す分析パック: 先頭が # の説明行(使い方の例つき)、1日1行。「説明行を付けない」もできる', async ({ page }) => {
  await adminLogin(page, 'admin', '/export');
  const panel = page.getByRole('region', { name: 'CSVを作る' });
  await expect(panel.getByRole('radio', { name: 'AIに渡す分析パック' })).toBeChecked();
  const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'ダウンロード' }).click()]);
  const bytes = await readFile((await dl.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = bytes.toString('utf8').slice(1).split('\r\n');
  expect(lines[0]).toBe('# グリーンドーム AIに渡す分析パック(CSV)');
  expect(lines.some((l) => l.startsWith('# - このCSVをそのままAIに渡し'))).toBe(true);
  expect(lines.find((l) => !l.startsWith('#'))).toMatch(/^日付,曜日,曜日区分,祝日名,臨時休業,休業の理由,天気,最高気温\(℃\)/);
  if (process.env.SHOT_DIR) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${process.env.SHOT_DIR}/AIに渡す分析パック(サンプル).csv`, bytes);
  }
  await panel.getByLabel(/説明行を付けない/).check();
  await panel.getByRole('radio', { name: 'AIに渡す おうちごとの表' }).check();
  const [dl2] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'ダウンロード' }).click()]);
  const plain = (await readFile((await dl2.path())!)).toString('utf8').slice(1).split('\r\n');
  expect(plain[0]).toMatch(/^おうち番号,登録した月,登録のしかた,都道府県,市区町村/);
});
