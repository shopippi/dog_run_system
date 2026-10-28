import { expect, test, type Page } from '@playwright/test';
import { cancelOnToday, checkinViaLiff, joinByReceptionInvite, lowContrast } from './households-helpers';
import { adminLogin, newLineUser, registerViaUi } from './helpers';

// おうちの詳細と記録(M-06、M-07、M-15)の文字と背景のコントラスト(ライトとダーク)
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };

async function check(page: Page, screen: string) {
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test.use({ colorScheme: scheme });

    test('おうちの詳細と記録の文字が背景に対して読める', async ({ browser }) => {
      test.setTimeout(120_000);
      const customer = await browser.newPage({ colorScheme: scheme });
      const user = newLineUser('パパ');
      await registerViaUi(customer, user, ['ルル']);
      await checkinViaLiff(customer, user);

      const page = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(page, 'admin');
      const found = await page.request.get('/admin/api/households?q=' + encodeURIComponent('るる'));
      const { households } = (await found.json()) as { households: { id: number }[] };
      await joinByReceptionInvite(page, customer, households[0]!.id, newLineUser('ママ'));
      await customer.close();
      await cancelOnToday(page, 'ルル');

      // M-15 操作ログ(元に戻した行と、戻せる行)
      await page.getByRole('link', { name: '操作ログ' }).click();
      const list = page.getByRole('list', { name: '操作の一覧' });
      await list.getByRole('listitem').filter({ hasText: 'ルルのおうち' }).first().waitFor();
      await check(page, 'M-15 操作ログ');
      await list.getByRole('listitem').filter({ hasText: 'ルルのおうち' }).first().getByRole('button', { name: '元に戻す' }).click();
      const dialog = page.getByRole('dialog', { name: '操作を元に戻す' });
      await dialog.waitFor();
      await check(page, 'M-15 元に戻すの確認');
      await dialog.getByRole('button', { name: '元に戻す' }).click();
      await list.getByText('元に戻し済み').first().waitFor();
      await check(page, 'M-15 操作ログ(元に戻し済み)');

      // M-06 おうちの詳細
      await list.getByRole('link', { name: /ルルのおうち/ }).first().click();
      const head = page.getByRole('region', { name: 'おうちの概要' });
      await head.getByRole('heading', { name: 'ルルのおうち' }).waitFor();
      await check(page, 'M-06 おうちの詳細');
      await head.getByRole('button', { name: '呼び名を変える' }).click();
      await check(page, 'M-06 呼び名の変更');
      await head.getByRole('button', { name: 'やめる' }).click();

      // ポイント・無料券の手動登録(入力 → 確認 → 登録後)
      await page.getByRole('button', { name: 'ポイント・無料券を登録' }).click();
      const mp = page.getByRole('dialog', { name: 'ポイント・無料券の手動登録' });
      await mp.getByRole('button', { name: 'ポイントを1ふやす' }).click();
      await mp.getByRole('radio', { name: 'お詫び' }).check();
      await check(page, 'M-06 ポイントの手動登録');
      await mp.getByRole('button', { name: '内容を確かめる' }).click();
      const confirm = page.getByRole('dialog', { name: 'この内容で登録しますか' });
      await confirm.waitFor();
      await check(page, 'M-06 ポイントの手動登録(確認)');
      await confirm.getByRole('button', { name: '登録する' }).click();
      await page.getByRole('status').waitFor();
      await check(page, 'M-06 おうちの詳細(登録後)');
      await page.getByRole('button', { name: '家族を追加' }).click();
      const fi = page.getByRole('dialog', { name: '家族を追加' });
      await fi.getByRole('img', { name: '家族の招待のQRコード' }).waitFor();
      await check(page, 'M-06 家族を追加(招待QR)');
      await fi.getByRole('button', { name: '閉じる' }).click();
      await page.getByRole('list', { name: '家族' }).getByRole('button', { name: 'ママさんを外す' }).click();
      await page.getByRole('dialog', { name: '家族を外す' }).waitFor();
      await check(page, 'M-06 家族を外すの確認');
      await page.getByRole('dialog', { name: '家族を外す' }).getByRole('button', { name: '外す' }).click();
      await page.getByRole('status').getByText(/外しました/).waitFor();
      await check(page, 'M-06 おうちの詳細(外れた家族)');

      // M-07 犬の編集
      await page.getByRole('link', { name: 'ルルの情報を見る・変える' }).click();
      await page.getByRole('heading', { name: 'ワンちゃんの情報の変更' }).waitFor();
      await page.getByRole('combobox', { name: /犬種/ }).selectOption({ label: '柴犬' });
      await page.getByLabel('犬種・サイズを変える理由').fill('まちがい');
      await check(page, 'M-07 犬の編集(変更中)');
      await page.getByRole('button', { name: '保存する' }).click();
      await page.getByRole('status').waitFor();
      await check(page, 'M-07 犬の編集(保存後・履歴)');
      await page.getByRole('button', { name: '登録をおやすみする' }).click();
      await page.getByRole('dialog', { name: 'ワンちゃんの登録をおやすみする' }).waitFor();
      await check(page, 'M-07 登録のおやすみの確認');
      await page.close();
    });
  });
}
