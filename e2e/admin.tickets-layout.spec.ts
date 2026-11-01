import { expect, test } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { adminLogin, newLineUser, registerViaUi } from './helpers';
import { earnPoints, exchangeToday, householdIdOf } from './tickets-helpers';

// 担当G: M-09 旧カードの引き継ぎ(A-05)と、M-06 の「無料券を使用済みにする」の見え方。PC(1280)とタブレット縦(768)。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

for (const v of VIEWPORTS) {
  test(`${v.name}: M-09 旧カードの引き継ぎと M-06 無料券の使用済みが、横にはみ出さず押しやすい大きさになっている`, async ({ browser, request }) => {
    test.setTimeout(120_000);
    const customer = await browser.newPage();
    const user = newLineUser('パパ');
    const memberNo = await registerViaUi(customer, user, ['ジョセフィーヌ', 'マルゲリータ']);
    await customer.close();
    await earnPoints(request, user, 10);
    await exchangeToday(request, user);

    const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
    await adminLogin(page, 'admin', '/migration');
    await page.getByRole('heading', { name: '旧カードの引き継ぎ' }).waitFor();
    await checkScreen(page, v.name, 'M-09 旧カードの引き継ぎ', v.touch);

    const picker = page.getByRole('group', { name: '引き継ぐおうちを探す' });
    await picker.getByRole('searchbox', { name: '探す言葉' }).fill(memberNo);
    await picker.getByRole('list', { name: '引き継ぐおうちを探すの候補' }).getByRole('button', { name: new RegExp(memberNo) }).click();
    const section = page.getByRole('region', { name: '直接入力' });
    await section.getByRole('radio', { name: '紙のスタンプカード' }).check();
    await section.getByLabel('旧カードのポイント数').fill('31');
    await section.getByText(/引き継げるのは最大30ポイントです。/).waitFor();
    await checkScreen(page, v.name, 'M-09 旧カードの引き継ぎ(上限を超えたとき)', v.touch);
    await section.getByLabel('旧カードのポイント数').fill('8');
    await section.getByLabel('旧カードを目で確かめた').check();
    await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
    await checkScreen(page, v.name, 'M-09 旧カードの引き継ぎ(入力)', v.touch);
    await section.getByRole('button', { name: '引き継ぐ' }).click();
    const dialog = page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' });
    await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
    await checkScreen(page, v.name, 'M-09 旧カードの引き継ぎ(確認)', v.touch);
    await dialog.getByRole('button', { name: '引き継ぐ' }).click();
    const list = page.getByRole('region', { name: '引き継ぎ済みの一覧' });
    await list.getByRole('listitem', { name: new RegExp(memberNo) }).waitFor();
    await checkScreen(page, v.name, 'M-09 旧カードの引き継ぎ(引き継ぎ済み)', v.touch);
    await list.getByRole('listitem', { name: new RegExp(memberNo) }).getByRole('button', { name: '元に戻す' }).click();
    await page.getByRole('dialog', { name: '引き継ぎを元に戻す' }).waitFor();
    await checkScreen(page, v.name, 'M-09 引き継ぎを元に戻す(確認)', v.touch);
    await page.getByRole('dialog', { name: '引き継ぎを元に戻す' }).getByRole('button', { name: 'やめる' }).click();

    // M-06 おうちの詳細の無料券と、使用済みにする確認
    const id = await householdIdOf(page, memberNo);
    await page.goto(`/admin/households/${id}`);
    const tickets = page.getByRole('list', { name: '無料券' });
    await tickets.getByRole('button', { name: '使用済みにする' }).waitFor();
    await checkScreen(page, v.name, 'M-06 おうちの詳細(無料券)', v.touch);
    await tickets.getByRole('button', { name: '使用済みにする' }).click();
    await page.getByRole('dialog', { name: '無料券を使用済みにする' }).waitFor();
    await checkScreen(page, v.name, 'M-06 無料券を使用済みにする(確認)', v.touch);
    await page.close();
  });
}
