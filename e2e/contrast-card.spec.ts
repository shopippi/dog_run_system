import { expect, test, type Page } from '@playwright/test';
import { setCardColor } from './card-helpers';
import { lowContrast } from './households-helpers';
import { newLineUser, openLiff, registerViaUi } from './helpers';

// 担当I: 会員証の背景(C-06)と背景を変える画面(L-07b)の文字と背景のコントラスト(WCAG の 4.5:1。ライトとダーク)。
// 写真の上の文字のコントラストは測れない(写真によって変わる)ので、単色で測る:
// 墨(初期値・濃い単色の代表)、灰(濃い単色でいちばん明るい)、砂と白(明るい単色。文字を墨にする)。
const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true };

async function check(page: Page, screen: string) {
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test('会員証の文字が、選んだ背景の上で読める', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const page = await browser.newPage({ ...PHONE, colorScheme: scheme });
      const user = newLineUser('パパ');
      await registerViaUi(page, user, ['アル', 'ニコ']);

      await openLiff(page, user);
      await expect(page.getByRole('region', { name: '会員証' })).toHaveClass(/mc-preset-ink/);
      await check(page, 'L-07 会員証(墨)');

      for (const [color, label] of [['gray', '灰'], ['sand', '砂'], ['white', '白']] as const) {
        await setCardColor(request, user, color);
        await openLiff(page, user);
        await expect(page.getByRole('region', { name: '会員証' })).toHaveClass(new RegExp(`mc-preset-${color}`));
        await check(page, `L-07 会員証(${label})`);
      }

      await openLiff(page, user, '/card/background');
      await page.getByRole('heading', { name: '会員証の背景' }).waitFor();
      await check(page, 'L-07b 背景を変える');
      await page.getByRole('radio', { name: '墨' }).check({ force: true });
      await expect(page.getByRole('status')).toHaveText('保存しました');
      await check(page, 'L-07b 背景を変える(保存のあと)');
      await page.close();
    });
  });
}
