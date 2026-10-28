import { expect, test, type Browser } from '@playwright/test';
import { cancelOnToday, checkScreen, checkinViaLiff, joinByReceptionInvite } from './households-helpers';
import { adminLogin, makePhoto, newLineUser, registerViaUi } from './helpers';

// おうちの詳細と記録(M-06、M-07、M-15)の見え方。PC(1280)とタブレット縦(768)で確かめる。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

/** 取り消したチェックインがある状態を作る */
async function seed(browser: Browser) {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  await registerViaUi(customer, user, ['ココア', 'キナコ']);
  await checkinViaLiff(customer, user);
  await customer.close();
  const page = await browser.newPage();
  await adminLogin(page, 'admin');
  await cancelOnToday(page, 'ココア', 'お客さんの勘違い');
  // 家族をもう1人(外すの確認を出すため)
  const household = await page.request.get('/admin/api/households?q=' + encodeURIComponent('ここあ'));
  const { households } = (await household.json()) as { households: { id: number }[] };
  const customer2 = await browser.newPage();
  await joinByReceptionInvite(page, customer2, households[0]!.id, newLineUser('ママ'));
  await customer2.close();
  await page.close();
}

test.describe('おうちの詳細と記録の見え方', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    await seed(browser);
  });

  for (const v of VIEWPORTS) {
    test(`${v.name}: 横にはみ出さず、押しやすい大きさになっている`, async ({ browser }) => {
      test.setTimeout(120_000);
      const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
      await adminLogin(page, 'admin');

      // M-15 操作ログ と 元に戻すの確認
      await page.getByRole('link', { name: '操作ログ' }).click();
      const row = page
        .getByRole('list', { name: '操作の一覧' })
        .getByRole('listitem')
        .filter({ hasText: 'ココア・キナコのおうち' })
        .filter({ has: page.getByText('チェックインの取り消し', { exact: true }) });
      await expect(row).toBeVisible();
      await checkScreen(page, v.name, 'M-15 操作ログ', v.touch);
      await row.getByRole('button', { name: '元に戻す' }).click();
      const dialog = page.getByRole('dialog', { name: '操作を元に戻す' });
      await expect(dialog).toBeVisible();
      await checkScreen(page, v.name, 'M-15 元に戻すの確認', v.touch);
      await dialog.getByRole('button', { name: 'やめる' }).click();
      await expect(dialog).toHaveCount(0);

      // M-06 おうちの詳細(探す → 詳しく)
      await page.getByRole('link', { name: 'おうちを探す' }).click();
      await page.getByRole('searchbox', { name: '探す言葉' }).fill('ここあ');
      const open = page.getByRole('link', { name: 'ココア・キナコのおうちの詳細を開く' });
      await expect(open).toBeVisible();
      await checkScreen(page, v.name, 'M-04 おうちを探す(管理者・詳しくのリンク)', v.touch);
      await open.click();
      const head = page.getByRole('region', { name: 'おうちの概要' });
      await expect(head.getByRole('heading', { name: 'ココア・キナコのおうち' })).toBeVisible();
      await checkScreen(page, v.name, 'M-06 おうちの詳細', v.touch);
      await head.getByRole('button', { name: '呼び名を変える' }).click();
      await checkScreen(page, v.name, 'M-06 呼び名の変更', v.touch);
      await head.getByRole('button', { name: 'やめる' }).click();

      // ポイント・無料券の手動登録(入力 → 確認)
      await page.getByRole('button', { name: 'ポイント・無料券を登録' }).click();
      const mp = page.getByRole('dialog', { name: 'ポイント・無料券の手動登録' });
      await mp.getByRole('button', { name: 'ポイントを1ふやす' }).click();
      await mp.getByRole('radio', { name: 'お詫び' }).check();
      await checkScreen(page, v.name, 'M-06 ポイントの手動登録', v.touch);
      await mp.getByRole('button', { name: '内容を確かめる' }).click();
      const confirm = page.getByRole('dialog', { name: 'この内容で登録しますか' });
      await expect(confirm).toBeVisible();
      await checkScreen(page, v.name, 'M-06 ポイントの手動登録(確認)', v.touch);
      await confirm.getByRole('button', { name: '戻る' }).click();
      await page.getByRole('dialog', { name: 'ポイント・無料券の手動登録' }).getByRole('button', { name: 'やめる' }).click();

      // 家族を追加(招待QR)
      await page.getByRole('button', { name: '家族を追加' }).click();
      const fi = page.getByRole('dialog', { name: '家族を追加' });
      await expect(fi.getByRole('img', { name: '家族の招待のQRコード' })).toBeVisible();
      await checkScreen(page, v.name, 'M-06 家族を追加(招待QR)', v.touch);
      await fi.getByRole('button', { name: '閉じる' }).click();

      // 家族を外すの確認
      await page.getByRole('list', { name: '家族' }).getByRole('button', { name: 'ママさんを外す' }).click();
      await expect(page.getByRole('dialog', { name: '家族を外す' })).toBeVisible();
      await checkScreen(page, v.name, 'M-06 家族を外すの確認', v.touch);
      await page.getByRole('dialog', { name: '家族を外す' }).getByRole('button', { name: 'やめる' }).click();

      // M-07 犬の編集(犬種を変えて理由の入力欄を出したところ・写真を選んだところ)
      await page.getByRole('link', { name: 'ココアの情報を見る・変える' }).click();
      await expect(page.getByRole('heading', { name: '登録の内容' })).toBeVisible();
      await checkScreen(page, v.name, 'M-07 犬の編集', v.touch);
      await page.getByRole('combobox', { name: /犬種/ }).selectOption({ label: '柴犬' });
      await page.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 1200, 900) });
      // 写真の縮小は端末の中で行うため、混んでいる端末では少し時間がかかる
      await expect(page.getByRole('img', { name: 'ココアの写真' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByLabel('犬種・サイズを変える理由')).toBeVisible();
      await checkScreen(page, v.name, 'M-07 犬の編集(変更中)', v.touch);
      await page.getByRole('button', { name: '登録をおやすみする' }).click();
      await expect(page.getByRole('dialog', { name: 'ワンちゃんの登録をおやすみする' })).toBeVisible();
      await checkScreen(page, v.name, 'M-07 登録のおやすみの確認', v.touch);
      await page.getByRole('dialog', { name: 'ワンちゃんの登録をおやすみする' }).getByRole('button', { name: 'やめる' }).click();

      await page.close();
    });
  }
});
