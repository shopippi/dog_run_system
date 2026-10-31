import { test } from '@playwright/test';
import { checkScreen } from './households-helpers';
import { adminLogin, newLineUser, registerViaUi } from './helpers';
import { sql } from './merge-helpers';
import { migrateViaApi } from './oldcard-helpers';

// M-09 旧カードの引き継ぎ(移行期間のまとめ・特典・カードの番号・同じ番号の知らせ)と M-19 切り替えの手順の見え方。
// PC(1280)とタブレット縦(768)とスマホ(390)。確かめ方は e2e/admin.tickets-layout.spec.ts と同じ。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
  { name: '390x844', viewport: { width: 390, height: 844 }, touch: true },
] as const;

for (const v of VIEWPORTS) {
  test(`${v.name}: M-09 旧カードの引き継ぎ(まとめ・特典・同じ番号)と M-19 切り替えの手順が、横にはみ出さず押しやすい`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ref = `L${v.viewport.width}-${Date.now().toString().slice(-5)}`;
    const customer = await browser.newPage();
    const a = await registerViaUi(customer, newLineUser('パパ'), ['ジョセフィーヌ', 'マルゲリータ']);
    const b = await registerViaUi(customer, newLineUser('ママ'), ['フランチェスカ']);
    await customer.close();
    await migrateViaApi(a, { source: 'paper_card', points: 30, card_points: 48, tickets: 1, card_ref: ref, note: '角が少し破れていた' });
    await migrateViaApi(b, { source: 'paper_card', points: 3, card_ref: ref, duplicate_ok: true });
    // もう1人の家族(長い名前)。だれのカードかの選択と、引き継いだカードの一覧を出す
    sql(
      `INSERT INTO family_members (household_id, line_user_id, line_display_name, age_group, gender, consented_at, joined_at, join_method, status, updated_at)
       SELECT id, 'Ulayout${v.viewport.width}${Date.now()}', 'おじいちゃん(ヨシノブ)', '70代以上', '男性', '2026-10-01T00:00:00+09:00',
              '2026-10-01T00:00:00+09:00', 'invite', 'active', '2026-10-01T00:00:00+09:00'
         FROM households WHERE member_no = '${b}'`,
    );

    const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
    await adminLogin(page, 'admin', `/migration?member=${encodeURIComponent(b)}`);
    const section = page.getByRole('region', { name: '直接入力' });
    await section.getByText('受付の前にいる人のカードを選んでください').waitFor();
    await section.getByRole('radiogroup', { name: 'だれのカード' }).getByRole('radio', { name: /おじいちゃん/ }).check();
    await section.getByRole('radio', { name: 'LINEのショップカード', exact: true }).waitFor();
    await section.getByRole('list', { name: 'このおうちで引き継いだカード' }).waitFor();
    await page.getByRole('region', { name: '引き継ぎ済みの一覧' }).getByText(`同じ番号: ${a}`).waitFor();
    await checkScreen(page, v.name, 'M-09 旧カードの引き継ぎ(まとめと一覧)', v.touch);
    await section.getByLabel('旧カードのポイント数').fill('50');
    await section.getByLabel('使っていない特典').fill('1');
    await section.getByLabel('カードの番号(任意)').fill('0123');
    await section.getByText(/引き継げるのは最大30ポイントです。/).waitFor();
    await checkScreen(page, v.name, 'M-09 旧カードの引き継ぎ(上限を超えて特典ありの入力)', v.touch);

    await page.goto('/admin/switchover');
    await page.getByRole('heading', { name: '切り替えの手順', level: 1 }).waitFor();
    await checkScreen(page, v.name, 'M-19 切り替えの手順', v.touch);
  });
}
