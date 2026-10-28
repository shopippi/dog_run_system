import { expect, test, type Page } from '@playwright/test';
import { answerSurvey, makePhoto, newLineUser, openCheckin, openLiff } from './helpers';

// LINE アプリの中で開いたときの見え方を確かめる(LIFF の Full サイズ)。
// 画面の大きさは、各機種の画面から LINE の上部のバーとステータスバーを除いたもの。
// ブラウザ名(UserAgent)も LINE の中のものにそろえる。
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0 LIFF';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Line/15.10.0/IAB LIFF';

const DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 603 }, dpr: 2, ua: IOS_UA, dark: false },
  { name: 'iPhone 16', viewport: { width: 393, height: 759 }, dpr: 3, ua: IOS_UA, dark: false },
  { name: 'Android 小さめ', viewport: { width: 360, height: 680 }, dpr: 3, ua: ANDROID_UA, dark: false },
  { name: 'Android Pixel 7', viewport: { width: 412, height: 839 }, dpr: 2.625, ua: ANDROID_UA, dark: false },
  { name: 'iPhone 16 ダークモード', viewport: { width: 393, height: 759 }, dpr: 3, ua: IOS_UA, dark: true },
] as const;

/**
 * 1つの画面を確かめる。
 * - 横にはみ出していない(横スクロールが出ない)
 * - 押すボタンの高さが 44px 以上(指で押しやすい)
 * - 入力欄の文字が 16px 以上(iPhone で入力するときに画面が勝手に拡大されない)
 * SHOT_DIR を指定すると、画面の写真を保存する。
 */
async function checkScreen(page: Page, device: string, screen: string) {
  await page.waitForLoadState('networkidle');
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    for (const el of document.querySelectorAll<HTMLElement>('button, a.btn, .menu a, label.up')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      if (r.height < 43.5) out.push(`ボタンが低い(${Math.round(r.height)}px): ${el.textContent?.trim().slice(0, 20)}`);
      if (r.right > doc.clientWidth + 1) out.push(`ボタンがはみ出し: ${el.textContent?.trim().slice(0, 20)}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.getAttribute('aria-label') ?? el.id}`);
    }
    return out;
  });
  expect(problems, `${device} / ${screen}`).toEqual([]);
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/${device}/${screen}.png`, fullPage: true });
  }
}

for (const d of DEVICES) {
  test.describe(d.name, () => {
    test.use({
      viewport: d.viewport,
      deviceScaleFactor: d.dpr,
      isMobile: true,
      hasTouch: true,
      userAgent: d.ua,
      colorScheme: d.dark ? 'dark' : 'light',
    });

    test('お客さん向けの全画面が、LINE の画面の中に収まる', async ({ page, browser }) => {
      const user = newLineUser('ママ');
      await openLiff(page, user);
      await page.getByRole('heading', { name: 'はじめての方へ' }).waitFor();
      await checkScreen(page, d.name, 'L-01 同意');

      await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
      await page.getByRole('button', { name: '同意して次へ' }).click();
      const first = page.locator('fieldset.dog-form').nth(0);
      await first.getByLabel('名前').fill('アルフォンス');
      await first.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'ミニチュアダックスフンド' });
      await first.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page) });
      await first.locator('img.av').waitFor();
      await page.getByRole('button', { name: '＋ もう1頭追加する' }).click();
      const second = page.locator('fieldset.dog-form').nth(1);
      await second.getByLabel('名前').fill('ニコ');
      await second.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'その他' });
      await second.getByRole('textbox', { name: /犬種を入力/ }).fill('ラブラドゥードル');
      await second.getByRole('radio', { name: '大型' }).check();
      await checkScreen(page, d.name, 'L-02 犬の登録');

      await page.getByRole('button', { name: '次へ' }).click();
      await answerSurvey(page);
      await checkScreen(page, d.name, 'L-03 アンケート');
      await page.getByRole('button', { name: '登録する' }).click();
      await page.getByText('登録が完了しました').waitFor();
      await checkScreen(page, d.name, 'L-04 登録完了');

      await page.getByRole('button', { name: '会員証を見る' }).click();
      await page.getByRole('region', { name: '会員証' }).waitFor();
      await checkScreen(page, d.name, 'L-07 会員証');

      await openCheckin(page, user);
      await page.getByRole('button', { name: 'チェックインする' }).waitFor();
      await checkScreen(page, d.name, 'L-05 チェックイン');
      await page.getByRole('button', { name: 'チェックインする' }).click();
      await page.getByRole('region', { name: 'チェックイン完了' }).waitFor();
      await checkScreen(page, d.name, 'L-06 チェックイン完了');

      await openLiff(page, user, '/dogs');
      await page.getByRole('heading', { name: 'ワンちゃん' }).waitFor();
      await checkScreen(page, d.name, 'L-09 犬の管理');
      await page.getByRole('link', { name: /アルフォンス/ }).click();
      await page.getByRole('button', { name: '保存する' }).waitFor();
      await checkScreen(page, d.name, 'L-09 犬の変更');

      await openLiff(page, user, '/family');
      await page.getByRole('button', { name: '招待のQRコードを表示する' }).click();
      await page.getByRole('img', { name: '家族の招待のQRコード' }).waitFor();
      await checkScreen(page, d.name, 'L-11 家族の招待');
      await page.getByRole('button', { name: 'LINEで招待を送る' }).click();
      await page.getByRole('status').waitFor();
      const messages = await page.evaluate(() => (window as unknown as { __sharedMessages: string[] }).__sharedMessages);
      const invitePath = messages.at(-1)!.match(/\/liff(\/invite\/[A-Za-z0-9_-]+)/)![1]!;

      const papa = await browser.newPage({
        viewport: d.viewport,
        deviceScaleFactor: d.dpr,
        isMobile: true,
        hasTouch: true,
        userAgent: d.ua,
        colorScheme: d.dark ? 'dark' : 'light',
      });
      await openLiff(papa, newLineUser('パパ'), invitePath);
      await papa.getByRole('button', { name: '参加する' }).waitFor();
      await checkScreen(papa, d.name, 'L-12 招待を受けたとき');
      await papa.close();
    });
  });
}
