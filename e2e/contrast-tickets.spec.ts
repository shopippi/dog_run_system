import { expect, test, type Page } from '@playwright/test';
import { lowContrast } from './households-helpers';
import { adminLogin, newLineUser, openLiff, registerViaUi } from './helpers';
import { checkinToday, earnPoints, exchangeToday, householdIdOf } from './tickets-helpers';

// 担当G: 無料券の交換と使用(C-06)、M-09 旧カードの引き継ぎ、M-06 の「無料券を使用済みにする」の、
// 文字と背景のコントラスト(WCAG の 4.5:1。ライトとダーク)。lowContrast は e2e/contrast.spec.ts と同じもの。
const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true };
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };

async function check(page: Page, screen: string) {
  expect(await lowContrast(page), screen).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test.use({ colorScheme: scheme });

    test('無料券の交換と使用の文字が背景に対して読める', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const page = await browser.newPage({ ...PHONE, colorScheme: scheme });
      const user = newLineUser('ママ');
      await registerViaUi(page, user, ['アル']);
      await earnPoints(request, user, 21);
      await checkinToday(request, user);
      await exchangeToday(request, user);

      await openLiff(page, user);
      await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).waitFor();
      await check(page, 'L-07 会員証(交換できるとき・無料券あり)');
      await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).click();
      await page.getByRole('dialog', { name: '無料券と交換します' }).waitFor();
      await check(page, 'L-07 会員証(交換の確認)');
      await page.getByRole('button', { name: '交換する' }).click();
      await page.getByRole('status').waitFor();
      await check(page, 'L-07 会員証(交換したあと)');
      await check(page, 'L-07 会員証(スライドの前)');
      // キーボードでも使える(スライダーにフォーカスして → を4回)
      const knob = page.getByRole('list', { name: '未使用の無料券' }).getByRole('listitem').first().getByRole('slider', { name: 'スライドして使用する' });
      await knob.focus();
      await page.keyboard.press('ArrowRight');
      // スライドの途中は、溝の文字がわざと薄れていく(昔の iPhone と同じ。読み上げはつまみの名前)ので、ここでは測らない
      await expect(knob).toHaveAttribute('aria-valuenow', '25');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.getByRole('region', { name: '無料券を使用できました' }).waitFor();
      await check(page, 'L-07 使用できました');
      await openLiff(page, user, '/history');
      await page.getByRole('region', { name: '無料券の記録' }).waitFor();
      await check(page, 'L-08 来場履歴(無料券の記録)');
      await page.close();
    });

    test('M-09 旧カードの引き継ぎと M-06 無料券の使用済みの文字が背景に対して読める', async ({ browser, request }) => {
      test.setTimeout(120_000);
      const customer = await browser.newPage();
      const user = newLineUser('パパ');
      const memberNo = await registerViaUi(customer, user, ['ペコ']);
      await customer.close();
      await earnPoints(request, user, 10);
      await exchangeToday(request, user);

      const page = await browser.newPage({ ...TABLET, colorScheme: scheme });
      await adminLogin(page, 'admin', '/migration');
      const picker = page.getByRole('group', { name: '引き継ぐおうちを探す' });
      await picker.getByRole('searchbox', { name: '探す言葉' }).fill(memberNo);
      await picker.getByRole('list', { name: '引き継ぐおうちを探すの候補' }).getByRole('button', { name: new RegExp(memberNo) }).click();
      const section = page.getByRole('region', { name: '直接入力' });
      await section.getByLabel('旧カードのポイント数').fill('40');
      await section.getByText('引き継げるポイントは最大30ポイントです。').waitFor();
      await check(page, 'M-09 旧カードの引き継ぎ(上限を超えたとき)');
      await section.getByLabel('旧カードのポイント数').fill('6');
      await section.getByLabel('旧カードを目で確かめた').check();
      await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
      await section.getByRole('button', { name: '引き継ぐ' }).click();
      const dialog = page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' });
      await dialog.waitFor();
      await check(page, 'M-09 旧カードの引き継ぎ(確認)');
      await dialog.getByRole('button', { name: '引き継ぐ' }).click();
      const list = page.getByRole('region', { name: '引き継ぎ済みの一覧' });
      const row = list.getByRole('listitem', { name: new RegExp(memberNo) });
      await row.getByRole('button', { name: '元に戻す' }).click();
      await page.getByRole('dialog', { name: '引き継ぎを元に戻す' }).getByRole('button', { name: '元に戻す' }).click();
      await row.getByText(/^元に戻しました/).waitFor();
      await check(page, 'M-09 旧カードの引き継ぎ(元に戻した行)');

      const id = await householdIdOf(page, memberNo);
      await page.goto(`/admin/households/${id}`);
      const tickets = page.getByRole('list', { name: '無料券' });
      await tickets.getByRole('button', { name: '使用済みにする' }).click();
      const use = page.getByRole('dialog', { name: '無料券を使用済みにする' });
      await use.waitFor();
      await check(page, 'M-06 無料券を使用済みにする(確認)');
      await use.getByRole('button', { name: '使用済みにする' }).click();
      await tickets.getByText('使用済み').waitFor();
      await check(page, 'M-06 おうちの詳細(使用済みの無料券)');
      await page.close();
    });
  });
}
