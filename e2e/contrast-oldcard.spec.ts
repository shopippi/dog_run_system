import { expect, test, type Page } from '@playwright/test';
import { lowContrast } from './households-helpers';
import { adminLogin, newLineUser, openLiff, registerViaUi } from './helpers';
import { migrateViaApi } from './oldcard-helpers';

// 旧カードの引き継ぎ(16章)の新しい画面と部品の、文字と背景のコントラスト(WCAG の 4.5:1。ライトとダーク)。
// M-09 の移行期間のまとめ・同じ番号の知らせ・上限の注意、M-19 切り替えの手順、L-07 の案内、L-08 の引き継ぎの記録。
const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true };
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };

async function check(page: Page, screen: string) {
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test.use({ colorScheme: scheme });

    test('旧カードの引き継ぎの画面と、お客さんの案内・記録の文字が背景に対して読める', async ({ browser }) => {
      test.setTimeout(120_000);
      const ref = `C${scheme}-${Date.now().toString().slice(-5)}`;
      const phone = await browser.newPage({ ...PHONE, colorScheme: scheme });
      const user = newLineUser('パパ');
      const a = await registerViaUi(phone, user, ['ペコ']);
      await openLiff(phone, user);
      await phone.getByRole('region', { name: '前のカードのポイントを引き継げます' }).waitFor();
      await check(phone, 'L-07 会員証(前のカードの案内)');
      await migrateViaApi(a, { source: 'line_card', points: 30, card_points: 33, tickets: 1, card_ref: ref });
      await openLiff(phone, user, '/history');
      await phone.getByRole('region', { name: '前のカードからの引き継ぎ' }).waitFor();
      await check(phone, 'L-08 来場履歴(前のカードからの引き継ぎ)');
      const b = await registerViaUi(phone, newLineUser('ママ'), ['ポコ']);
      await migrateViaApi(b, { source: 'line_card', points: 2, card_ref: ref, duplicate_ok: true });
      await phone.close();

      const page = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(page, 'admin', `/migration?member=${encodeURIComponent(b)}`);
      await page.getByRole('region', { name: '引き継ぎ済みの一覧' }).getByText(`同じ番号: ${a}`).waitFor();
      const section = page.getByRole('region', { name: '直接入力' });
      await section.getByRole('radio', { name: '紙のスタンプカード' }).check();
      await section.getByLabel('旧カードのポイント数').fill('45');
      await section.getByText(/引き継げるのは最大30ポイントです。/).waitFor();
      await check(page, 'M-09 旧カードの引き継ぎ(まとめ・上限の注意・同じ番号)');
      await section.getByLabel('旧カードのポイント数').fill('3');
      await section.getByLabel('カードの番号(任意)').fill(ref);
      await section.getByLabel('旧カードを目で確かめた').check();
      await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
      await section.getByRole('button', { name: '引き継ぐ' }).click();
      const dialog = page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' });
      await dialog.getByRole('button', { name: '引き継ぐ' }).click();
      // 紙のカードの番号は LINE のショップカードの番号とは別に数えるので、ここでは引き継げる
      await page.getByRole('region', { name: '引き継ぎ済みの一覧' }).getByRole('listitem', { name: new RegExp(`${b} 紙のスタンプカード`) }).waitFor();
      await page.goto('/admin/switchover');
      await page.getByRole('heading', { name: '切り替えの手順', level: 1 }).waitFor();
      await check(page, 'M-19 切り替えの手順');
      await page.close();
    });
  });
}
