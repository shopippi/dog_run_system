import { expect, test, type Browser, type Page } from '@playwright/test';
import { adminLogin, answerSurvey, makePhoto, newLineUser, openCheckin, openLiff, registerViaUi } from './helpers';

// 受付・管理画面の見え方を確かめる(e2e/liff.layout.spec.ts と同じ考え方)。
// PC(1280)・タブレット横(1024)・タブレット縦(768)の3つの幅で、主な画面を通しで操作する。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '1024x768', viewport: { width: 1024, height: 768 }, touch: true },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

/**
 * 1つの画面を確かめる。
 * - 横にはみ出していない(横スクロールが出ない)
 * - 押す部品の高さが、指で操作する端末(hasTouch)では 44px 以上、マウスでは 40px 以上
 *   (一覧の中の「取り消す」などの控えめなボタンも含む)
 * - 入力欄の文字が 16px 以上
 * SHOT_DIR を指定すると、画面の写真を保存する。
 */
async function checkScreen(page: Page, folder: string, screen: string, touch: boolean) {
  await page.waitForLoadState('networkidle');
  // 開くときの動き(ダイアログなど)が終わってから確かめる
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const minHeight = touch ? 44 : 40;
  const problems = await page.evaluate((minHeight) => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    const pressables = document.querySelectorAll<HTMLElement>(
      'button, a, [role=tab], .chips label, .pick-row, label.check',
    );
    for (const el of pressables) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20);
      if (r.height < minHeight - 0.5) out.push(`押す部品が低い(${Math.round(r.height)}px): ${name}`);
      // 横スクロールのメニュー(狭い画面)の中は、はみ出しではない
      const inScroller = el.closest('.nav') !== null && doc.clientWidth < 960;
      if (!inScroller && r.right > doc.clientWidth + 1) out.push(`押す部品がはみ出し: ${name}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.getAttribute('aria-label') ?? el.id}`);
    }
    return out;
  }, minHeight);
  expect(problems, `${folder} / ${screen}`).toEqual([]);
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/${folder}/${screen}.png`, fullPage: true });
  }
}

/** 写真つきで登録する(一覧に写真のある犬と、ない犬を混ぜるため) */
async function registerWithPhoto(page: Page, user: string, names: [string, ...string[]]) {
  await openLiff(page, user);
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  for (const [i, name] of names.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'もう1頭追加する' }).click();
    const form = page.locator('fieldset.dog-form').nth(i);
    await form.getByLabel('名前').fill(name);
    await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: i === 0 ? '柴犬' : 'プードル' });
    if (i === 0) {
      await form.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page) });
      await form.locator('img.av').waitFor();
    }
  }
  await page.getByRole('button', { name: '次へ' }).click();
  await answerSurvey(page);
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByText('登録が完了しました').waitFor();
}

async function checkinViaLiff(page: Page, user: string) {
  await openCheckin(page, user);
  await page.getByRole('button', { name: 'チェックインする' }).click();
  await page.getByRole('region', { name: 'チェックイン完了' }).waitFor();
}

/**
 * 来場が数件ある状態を作る。
 * マロン・ショコラ(写真あり・本人がチェックイン)、ハナ(受付で代理)、レオ(取り消し済み)、ソラ(まだ来ていない)。
 */
async function seed(browser: Browser) {
  const customer = await browser.newPage();
  const a = newLineUser('パパ');
  await registerWithPhoto(customer, a, ['マロン', 'ショコラ']);
  await checkinViaLiff(customer, a);
  const b = newLineUser('おばあちゃん');
  await registerViaUi(customer, b, ['ハナ']);
  const c = newLineUser('ママ');
  await registerViaUi(customer, c, ['レオ']);
  await checkinViaLiff(customer, c);
  await registerViaUi(customer, newLineUser('むすこ'), ['ソラ']);
  await customer.close();

  const staff = await browser.newPage();
  await adminLogin(staff, 'staff', '/proxy');
  await staff.getByRole('searchbox', { name: '探す言葉' }).fill('はな');
  await staff.getByRole('list', { name: '見つかったおうち' }).getByRole('button', { name: /ハナのおうち/ }).click();
  const proxy = staff.getByRole('group', { name: '代理チェックイン' });
  await proxy.getByRole('button', { name: '代理でチェックインする' }).click();
  await proxy.getByRole('status').waitFor();

  await staff.getByRole('link', { name: '今日の来場' }).click();
  const row = staff.getByRole('listitem', { name: /レオ/ });
  await row.getByRole('button', { name: '取り消す' }).click();
  const dialog = staff.getByRole('dialog', { name: 'チェックインを取り消す' });
  await dialog.getByRole('radio', { name: 'お客さんの勘違い' }).check();
  await dialog.getByRole('button', { name: '取り消す' }).click();
  await row.getByText(/取り消し済み/).waitFor();
  await staff.close();
}

test.describe('受付・管理画面の見え方', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await seed(browser);
  });

  for (const v of VIEWPORTS) {
    test(`${v.name}: 主な画面が横にはみ出さず、押しやすい大きさになっている`, async ({ browser }) => {
      test.setTimeout(120_000);
      const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });

      await page.goto('/admin/');
      await page.getByRole('button', { name: 'ログイン' }).waitFor();
      await checkScreen(page, v.name, 'M-01 ログイン', v.touch);
      await adminLogin(page, 'staff');

      // 今日の来場(会員以外のお客さんも記録する)
      const list = page.getByRole('list', { name: '今日の来場' });
      await expect(list.getByText('マロン・ショコラ', { exact: true })).toBeVisible();
      const walkin = page.getByRole('region', { name: '会員以外のお客さん' });
      await walkin.getByRole('button', { name: '1頭ふやす' }).click();
      await walkin.getByRole('button', { name: '記録する' }).click();
      await walkin.getByRole('status').waitFor();
      await expect(list.getByText('会員以外 2頭').first()).toBeVisible();
      await checkScreen(page, v.name, 'M-02 今日の来場', v.touch);

      // 取り消しの確認(確かめたら「やめる」で閉じる)
      const cancelButton = page.getByRole('listitem', { name: /マロン/ }).getByRole('button', { name: '取り消す' });
      await cancelButton.click();
      const dialog = page.getByRole('dialog', { name: 'チェックインを取り消す' });
      await expect(dialog).toBeVisible();
      // 開いたときは安全な方(やめる)にフォーカスがある
      await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
      await checkScreen(page, v.name, 'M-02 取り消しの確認', v.touch);
      await dialog.getByRole('button', { name: 'やめる' }).click();
      await expect(dialog).toHaveCount(0);
      // 閉じたら、開く前のボタンにフォーカスが戻る
      await expect(cancelButton).toBeFocused();

      // おうちを探す(名前で探す → 選ぶ)
      await page.getByRole('link', { name: 'おうちを探す' }).click();
      await page.getByRole('searchbox', { name: '探す言葉' }).fill('まろん');
      const results = page.getByRole('list', { name: '見つかったおうち' });
      await results.getByRole('button', { name: /マロン・ショコラのおうち/ }).click();
      await expect(page.getByRole('region', { name: 'マロン・ショコラのおうちの内容' })).toBeVisible();
      await checkScreen(page, v.name, 'M-04 おうちを探す(名前)', v.touch);

      // 写真で探す
      await page.getByRole('tab', { name: '写真で探す' }).click();
      await expect(page.getByRole('list', { name: '最近来たワンちゃん' }).getByText('マロン', { exact: true })).toBeVisible();
      await checkScreen(page, v.name, 'M-04 おうちを探す(写真)', v.touch);

      // 代理チェックイン(おうちを選んだところ。確定はしない)
      await page.getByRole('link', { name: '代理チェックイン' }).click();
      await page.getByRole('searchbox', { name: '探す言葉' }).fill('そら');
      await page.getByRole('list', { name: '見つかったおうち' }).getByRole('button', { name: /ソラのおうち/ }).click();
      const proxy = page.getByRole('group', { name: '代理チェックイン' });
      await expect(proxy.getByRole('button', { name: '代理でチェックインする' })).toBeEnabled();
      await checkScreen(page, v.name, 'M-03 代理チェックイン', v.touch);

      await page.close();
    });
  }

  test('製作者のアカウントでは「見るだけ」の案内を出す', async ({ browser }) => {
    const v = VIEWPORTS[0];
    const page = await browser.newPage({ viewport: v.viewport });
    await adminLogin(page, 'developer');
    await expect(page.getByText('製作者のアカウントは見るだけです')).toBeVisible();
    await expect(page.getByRole('list', { name: '今日の来場' }).getByText('マロン・ショコラ', { exact: true })).toBeVisible();
    await checkScreen(page, v.name, 'M-02 今日の来場(製作者・見るだけ)', v.touch);
    await page.close();
  });
});
