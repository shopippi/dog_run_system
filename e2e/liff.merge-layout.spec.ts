import { expect, test, type Page } from '@playwright/test';
import { joinFamily } from './customer-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';
import { openMergeInvite, registerWithPhoto } from './merge-helpers';
import { liffShot } from './liff-shot';

// 担当H: L-12 おうちを一つにまとめる(C-12)の見え方。e2e/liff.layout.spec.ts と同じ確かめ方。
// LINE アプリの中で開いたときの大きさ(iPhone SE と iPhone 16)で確かめる。
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0 LIFF';

const DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 603 }, dpr: 2 },
  { name: 'iPhone 16', viewport: { width: 393, height: 759 }, dpr: 3 },
] as const;

/**
 * 1つの画面を確かめる(liff.layout.spec.ts の checkScreen と同じ)。
 * - 横にはみ出していない
 * - 押すボタンと選択肢の高さが 44px 以上(選ぶ行 .pick-row も含める)
 * - 入力欄の文字が 16px 以上
 * SHOT_DIR を指定すると、画面の写真を保存する。
 */
async function checkScreen(page: Page, device: string, screen: string) {
  await page.waitForLoadState('networkidle');
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    for (const el of document.querySelectorAll<HTMLElement>('button, a.btn, .menu a, label.up, .segment label, .chips label, .pick-row')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      if (r.height < 43.5) out.push(`ボタンが低い(${Math.round(r.height)}px): ${el.textContent?.trim().slice(0, 20)}`);
      if (r.right > doc.clientWidth + 1) out.push(`ボタンがはみ出し: ${el.textContent?.trim().slice(0, 20)}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.getAttribute('aria-label') ?? el.id}`);
    }
    // 文字が枠からはみ出していない(長い呼び名・犬の名前)
    for (const el of document.querySelectorAll<HTMLElement>('.mg-summary dd, .pick-body b, .dog-row-body b, .welcome-card .name')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`文字が切れている: ${el.textContent?.trim().slice(0, 20)}`);
    }
    return out;
  });
  expect(problems, `${device} / ${screen}`).toEqual([]);
  if (process.env.SHOT_DIR) {
    await liffShot(page, `${process.env.SHOT_DIR}/${device}/${screen}.png`);
  }
}

for (const d of DEVICES) {
  test.describe(d.name, () => {
    test.use({ viewport: d.viewport, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: IOS_UA });

    test('L-12 おうちを一つにまとめる: 下見 → 同じ子と写真 → 確認 → 完了 → 家族へのお知らせが、LINE の画面の中に収まる', async ({ page, request }) => {
      test.setTimeout(120_000);
      const papa = newLineUser('パパ');
      const mama = newLineUser('ママ');
      const baaba = newLineUser('ばあば');
      const papaNo = await registerWithPhoto(page, papa, ['アルフォンス・ド・ラ・モンターニュ']);
      const mamaNo = await registerWithPhoto(page, mama, ['あるくん', 'チョコレートクッキー']);
      await joinFamily(request, mama, baaba);

      await openMergeInvite(page, papa, mama);
      const summary = page.getByRole('region', { name: 'まとめた後' });
      await expect(summary.getByText(papaNo)).toBeVisible();
      await expect(page.getByText(/ばあばさんも、一緒に/)).toBeVisible();
      await checkScreen(page, d.name, 'L-12 おうちを一つにまとめる(下見)');

      const same = page.getByRole('group', { name: 'あるくんの同じ子' });
      await same.getByRole('radio', { name: /^アルフォンス.*同じ子$/ }).check();
      // 両方に写真があるので、残す写真を選べる。写真がない子(チョコレートクッキー)には出ない
      await same.getByRole('radio', { name: /あなたの写真/ }).check();
      await expect(page.getByRole('group', { name: 'チョコレートクッキーの同じ子' }).getByRole('radio', { name: /あなたの写真/ })).toHaveCount(0);
      await checkScreen(page, d.name, 'L-12 おうちを一つにまとめる(同じ子と写真)');

      await page.getByRole('button', { name: 'まとめる', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'まとめてよいですか?' })).toBeVisible();
      await expect(page.getByText(new RegExp(`パパさんのおうちと一つになります。ポイントは合計 .*あなたの会員IDは ${papaNo}`))).toBeVisible();
      await checkScreen(page, d.name, 'L-12 おうちを一つにまとめる(確認)');

      await page.getByRole('button', { name: 'まとめる', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'おうちが一つになりました' })).toBeVisible();
      await expect(page.locator('.welcome-card .id.mono')).toHaveText(papaNo);
      await checkScreen(page, d.name, 'L-12 おうちが一つになりました');
      await page.getByRole('button', { name: '会員証を見る' }).click();
      await expect(page.getByRole('region', { name: '会員証' }).getByText(papaNo)).toBeVisible();

      // 一緒に移ったばあばには、次に開いたとき1回だけお知らせが出る
      await openLiff(page, baaba);
      await expect(page.getByRole('heading', { name: 'おうちが一つになりました' })).toBeVisible();
      await expect(page.getByText(`これまでの会員ID(${mamaNo})`)).toBeVisible();
      await checkScreen(page, d.name, 'L-12 おうちが一つになりました(お知らせ)');
      await page.getByRole('button', { name: '会員証を見る' }).click();
      await expect(page.getByRole('region', { name: '会員証' }).getByText(papaNo)).toBeVisible();
      await openLiff(page, baaba);
      await expect(page.getByRole('region', { name: '会員証' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'おうちが一つになりました' })).toHaveCount(0);
    });

    test('L-12 写真のないおうちどうしでも収まり、「やめる」で何も変わらない', async ({ page }) => {
      const papa = newLineUser('パパ');
      const mama = newLineUser('ママ');
      await registerViaUi(page, papa, ['ミルフィ']);
      const mamaNo = await registerViaUi(page, mama, ['みるふぃちゃん']);
      await openMergeInvite(page, papa, mama);
      await page.getByRole('group', { name: 'みるふぃちゃんの同じ子' }).getByRole('radio', { name: /^ミルフィ.*同じ子$/ }).check();
      // どちらにも写真がないときは、写真の選択肢は出ない
      await expect(page.getByText('残す写真')).toHaveCount(0);
      await checkScreen(page, d.name, 'L-12 おうちを一つにまとめる(写真なし)');
      await page.getByRole('link', { name: 'やめる' }).click();
      await expect(page.getByRole('region', { name: '会員証' }).getByText(mamaNo)).toBeVisible();
    });
  });
}
