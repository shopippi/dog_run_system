import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { adminLogin, adminToast, openCheckin, openLiff } from './helpers';
import {
  alreadySeeded,
  desktopContext,
  dogPicture,
  paperCardPhoto,
  phoneContext,
  registerByApi,
  scrollToTop,
  seedManualData,
} from './manual-helpers';
import { insertMigrationRequest, putMedia, sendInvite, sql, visitYesterday } from './merge-helpers';

// マニュアル(docs/manual-*.md)の写真を撮り直す。ふだんの e2e では動かさない。
//   pnpm manual:shots   (MANUAL_SHOTS=1 E2E_PORT=8798 playwright test e2e/manual-shots.spec.ts)
// 写真は docs/images/manual/<名前>.png に保存する。

test.skip(!process.env.MANUAL_SHOTS, 'マニュアルの写真は MANUAL_SHOTS=1 のときだけ撮る');
test.describe.configure({ mode: 'serial' });

const OUT = path.resolve(__dirname, '../docs/images/manual');

/** 画面の写真を保存する(フォーカスの枠やカーソルを消してから) */
async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  mkdirSync(OUT, { recursive: true });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  // 押したボタンにカーソルが残って、ホバーの色で写らないように
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: opts.fullPage ?? false, animations: 'disabled', caret: 'hide' });
}

// デモ(apps/demo)と同じ固定のおうちと LINE のアカウント(apps/demo/src/seed/fixtures.ts)
const MAMA = 'U-demo-mama:こむぎママ';
const PAPA = 'U-demo-papa:こむぎパパ';
const TAKA = 'U-demo-taka:taka_papa';
const NICO = 'U-demo-nico:nico.mama';
const NEWCOMER = 'U-manual-new-1:そらママ';
// 同じサーバーで撮り直すときに、LINE のアカウントがぶつからないように
const RUN = Date.now().toString(36);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  if (!alreadySeeded()) await seedManualData(browser);
});

test('お客さん: 登録', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  await openLiff(page, NEWCOMER);
  await expect(page.getByRole('heading', { name: 'はじめての方へ' })).toBeVisible();
  await shot(page, 'customer-consent');

  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  await expect(page.getByRole('heading', { name: 'ワンちゃんの登録' })).toBeVisible();
  const form = page.locator('fieldset.dog-form').first();
  await form.locator('input[type=file]').setInputFiles({ name: 'sora.jpg', mimeType: 'image/jpeg', buffer: await dogPicture(page, 4) });
  await form.locator('img.av').waitFor();
  await form.getByLabel('名前').fill('ソラ');
  await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: '柴犬' });
  await form.getByRole('radio', { name: 'オス' }).check({ force: true });
  await shot(page, 'customer-dogs');

  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByRole('heading', { name: 'かんたんなアンケート' }).waitFor();
  await page.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '30代' }).check({ force: true });
  await page.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '女性' }).check({ force: true });
  await page.getByRole('radiogroup', { name: /きっかけ/ }).getByRole('radio', { name: 'Googleマップ' }).check({ force: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'customer-survey');

  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByText('登録が完了しました')).toBeVisible();
  await shot(page, 'customer-done');
  await context.close();
});

test('お客さん: 会員証・チェックイン・無料券', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  await openLiff(page, MAMA);
  await expect(page.getByRole('region', { name: 'スタンプ' }).getByText('9 / 10', { exact: true })).toBeVisible();
  await shot(page, 'customer-card');

  // チェックイン(こむぎだけ)
  await openCheckin(page, MAMA);
  await page.getByRole('checkbox', { name: /だいず/ }).uncheck({ force: true });
  await shot(page, 'customer-checkin');
  await page.getByRole('button', { name: 'チェックインする' }).click();
  await expect(page.getByRole('region', { name: 'チェックイン完了' })).toBeVisible();
  await shot(page, 'customer-checkin-done');

  // 10ポイントになり、スタンプのパネルに「無料券と交換する」が出る
  await openLiff(page, MAMA);
  const stamps = page.getByRole('region', { name: 'スタンプ' });
  await expect(stamps.getByText('10 / 10', { exact: true })).toBeVisible();
  await scrollToTop(stamps);
  await shot(page, 'customer-stamps');

  await page.getByRole('button', { name: '無料券と交換する(10ポイント)' }).click();
  await expect(page.getByRole('group', { name: '無料券との交換の確認' })).toBeVisible();
  await scrollToTop(stamps);
  await shot(page, 'customer-ticket-exchange');
  await page.getByRole('group', { name: '無料券との交換の確認' }).getByRole('button', { name: '交換する' }).click();
  await expect(page.getByRole('status')).toHaveText('無料券と交換しました。');

  const row = page.getByRole('list', { name: '未使用の無料券' }).getByRole('listitem').first();
  // スライドの途中(右へ半分ほど動かしたところ)を撮る。キーボードで 2 段階動かす
  const knob = row.getByRole('slider', { name: 'スライドして使用する' });
  await knob.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(knob).toHaveAttribute('aria-valuenow', '50');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await scrollToTop(page.locator('section.tk-section'));
  await shot(page, 'customer-ticket-use');
  await knob.focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('region', { name: '無料券を使用できました' })).toBeVisible();
  await shot(page, 'customer-ticket-used');
  await context.close();
});

test('お客さん: 家族の招待・同じ日のチェックイン', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  await openLiff(page, MAMA, '/family');
  await expect(page.getByRole('heading', { name: '家族を招待' })).toBeVisible();
  await shot(page, 'customer-family');

  const invitePath = await sendInvite(page, MAMA);
  await openLiff(page, PAPA, invitePath);
  await expect(page.getByRole('heading', { name: /参加しますか/ })).toBeVisible();
  await page.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '40代' }).check({ force: true });
  await page.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '男性' }).check({ force: true });
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'customer-join');
  await page.getByRole('button', { name: '参加する' }).click();
  await expect(page.getByText('参加しました')).toBeVisible();

  // ママが今日もうチェックインしているので、だいずを追加するだけ
  await openCheckin(page, PAPA);
  await expect(page.getByText(/チェックイン済み/).first()).toBeVisible();
  await shot(page, 'customer-checkin-family');
  await context.close();
});

test('お客さん: 会員証の背景', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  await openLiff(page, TAKA, '/card/background');
  await expect(page.getByRole('heading', { name: '会員証の背景' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '紺' })).toBeChecked();
  await shot(page, 'customer-card-background');
  await context.close();
});

test('お客さん: 招待からおうちを一つにまとめる', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  // taka_papa から届いている招待(初期データ)を nico.mama が開く
  await openLiff(page, NICO, '/invite/demo-merge-invite');
  await expect(page.getByRole('heading', { name: 'おうちを一つにまとめる' })).toBeVisible();
  await page.getByRole('group', { name: 'アルの同じ子' }).getByRole('radio', { name: /^アル.*同じ子$/ }).check({ force: true });
  await shot(page, 'customer-merge', { fullPage: true });
  await page.getByRole('button', { name: 'まとめる', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'まとめてよいですか?' })).toBeVisible();
  await shot(page, 'customer-merge-confirm');
  await page.getByRole('button', { name: 'まとめる', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'おうちが一つになりました' })).toBeVisible();
  await shot(page, 'customer-merge-done');
  await context.close();
});

test('お客さん: ワンちゃんの変更・おやすみ・プロフィール', async ({ browser }) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  await openLiff(page, MAMA, '/dogs');
  await expect(page.getByRole('heading', { name: 'ワンちゃん' })).toBeVisible();
  await page.getByRole('link', { name: /こむぎ/ }).click();
  await expect(page.getByRole('heading', { name: 'こむぎ' })).toBeVisible();
  const more = page.locator('details.pf-more');
  if (!(await more.evaluate((d: HTMLDetailsElement) => d.open))) await more.locator('summary').click();
  // 体重・相性・予防注射の年は任意。入れたところを写す(保存はしない)
  await page.getByLabel('体重').fill('6.4');
  await more.getByRole('radio', { name: '得意' }).check({ force: true });
  await page.getByLabel('狂犬病の予防注射').selectOption({ index: 1 });
  await scrollToTop(page.getByText('生まれた年月').first());
  await shot(page, 'customer-dog-edit');
  await page.getByRole('button', { name: 'この子の登録をおやすみする' }).click();
  await expect(page.getByRole('group', { name: '登録のおやすみの確認' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, 'customer-dog-rest');
  await page.getByRole('button', { name: 'やめる' }).click();

  await openLiff(page, MAMA, '/profile');
  await expect(page.getByRole('heading', { name: 'プロフィール' })).toBeVisible();
  await scrollToTop(page.getByText('来たい時間帯').first(), 120);
  await shot(page, 'customer-profile');
  await context.close();
});

// ---------------------------------------------------------------- 受付・管理画面(PC 1280×800)

test('受付: ログイン・今日の来場・おうちを探す', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  await page.goto('/admin/');
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  await shot(page, 'admin-login');

  await adminLogin(page, 'staff');
  const today = page.getByRole('list', { name: '今日の来場' });
  await expect(today.getByRole('listitem', { name: /こむぎ/ }).getByText('無料券を使用')).toBeVisible();
  await shot(page, 'staff-today');

  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('こむぎ');
  await page.getByRole('list', { name: '見つかったおうち' }).getByRole('button', { name: /こむぎ・だいずのおうち/ }).click();
  await expect(page.getByRole('region', { name: 'こむぎ・だいずのおうちの内容' })).toBeVisible();
  await shot(page, 'staff-search');
  await context.close();
});

test('管理者: 今日の来場・会員以外・取り消し・代理チェックイン・探す', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  await adminLogin(page, 'admin');
  const today = page.getByRole('list', { name: '今日の来場' });
  await expect(today.getByRole('listitem', { name: /こむぎ/ }).first()).toBeVisible();
  await shot(page, 'admin-today');

  const walkin = page.getByRole('region', { name: '会員以外のお客さん' });
  await walkin.getByRole('button', { name: '1頭ふやす' }).click();
  await walkin.getByRole('button', { name: '記録する' }).click();
  await expect(adminToast(page, 'を記録しました')).toBeVisible();
  await shot(page, 'admin-walkin');

  // 初期データの今日の来場(こむぎ以外)を1件取り消す
  const row = today.getByRole('listitem').filter({ has: page.getByRole('button', { name: '取り消す' }) }).filter({ hasNotText: 'こむぎ' }).filter({ hasNotText: '会員以外' }).first();
  await row.getByRole('button', { name: '取り消す' }).click();
  const dialog = page.getByRole('dialog', { name: 'チェックインを取り消す' });
  await dialog.getByRole('radio', { name: '二重のチェックイン' }).check({ force: true });
  await shot(page, 'admin-cancel');
  await dialog.getByRole('button', { name: '取り消す' }).click();
  await expect(today.getByText('取り消し済み(二重のチェックイン)')).toBeVisible();
  await scrollToTop(today.getByText('取り消し済み(二重のチェックイン)'), 200);
  await shot(page, 'admin-today-cancelled');

  await page.getByRole('link', { name: '代理チェックイン' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('DR-000004');
  await page.getByRole('list', { name: '見つかったおうち' }).getByRole('button', { name: /もものおうち/ }).first().click();
  await expect(page.getByRole('group', { name: '代理チェックイン' })).toBeVisible();
  await shot(page, 'admin-proxy');

  // 代理チェックインと同じ部品なので、読み込み直してから探す
  await page.goto('/admin/search');
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('こむぎ');
  await page.getByRole('list', { name: '見つかったおうち' }).getByRole('button', { name: /こむぎ・だいずのおうち/ }).click();
  await expect(page.getByRole('region', { name: 'こむぎ・だいずのおうちの内容' })).toBeVisible();
  await shot(page, 'admin-search');
  await page.getByRole('tab', { name: '写真で探す' }).click();
  await expect(page.getByRole('list', { name: '最近来たワンちゃん' }).locator('img').first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'admin-search-photo');
  await context.close();
});

test('製作者: 見るだけの表示', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  await adminLogin(page, 'developer');
  await expect(page.getByText('製作者のアカウントは見るだけです')).toBeVisible();
  await shot(page, 'admin-developer');
  await context.close();
});

test('管理者: おうちの詳細・手動登録・ワンちゃん・家族', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  await adminLogin(page, 'admin', '/households/1');
  const head = page.getByRole('region', { name: 'おうちの概要' });
  await expect(head.getByRole('heading', { name: 'こむぎ・だいずのおうち' })).toBeVisible();
  await shot(page, 'admin-household');
  await scrollToTop(page.getByRole('list', { name: '来場履歴' }), 80);
  await shot(page, 'admin-household-records');

  // おうちの回答(来たい時間帯・興味のあるイベントなど)
  await page.getByRole('region', { name: 'アンケート' }).getByRole('button', { name: 'おうちの回答を変える' }).click();
  const profile = page.getByRole('dialog', { name: 'おうちの回答を変える' });
  await expect(profile).toBeVisible();
  await shot(page, 'admin-household-profile');
  await profile.getByRole('button', { name: 'やめる' }).click();

  // ポイント・無料券の手動登録
  await page.getByRole('button', { name: 'ポイント・無料券を登録' }).click();
  const points = page.getByRole('dialog', { name: 'ポイント・無料券の手動登録' });
  await points.getByRole('button', { name: 'ポイントを1ふやす' }).click();
  await points.getByRole('radio', { name: 'イベントの特典' }).check({ force: true });
  await points.getByLabel('理由の内容').fill('ハロウィン仮装の日の参加特典');
  await shot(page, 'admin-points');
  await points.getByRole('button', { name: '内容を確かめる' }).click();
  const preview = page.getByRole('dialog', { name: 'この内容で登録しますか' });
  await expect(preview).toBeVisible();
  await shot(page, 'admin-points-preview');
  await preview.getByRole('button', { name: '登録する' }).click();
  await expect(adminToast(page, 'ポイント')).toBeVisible();

  // 家族を追加(QRコード)・家族を外す(確認だけ)
  await page.getByRole('button', { name: '家族を追加' }).click();
  await expect(page.getByRole('dialog', { name: '家族を追加' }).getByRole('img', { name: '家族の招待のQRコード' })).toBeVisible();
  await shot(page, 'admin-family-add');
  await page.getByRole('dialog', { name: '家族を追加' }).getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('list', { name: '家族' }).getByRole('button', { name: /こむぎのばあば.*を外す/ }).click();
  const remove = page.getByRole('dialog', { name: '家族を外す' });
  await expect(remove).toBeVisible();
  await shot(page, 'admin-family-remove');
  await remove.getByRole('button', { name: 'やめる' }).click();

  // ワンちゃんの情報の変更・登録をおやすみする(確認だけ)
  await page.getByRole('link', { name: 'こむぎの情報を見る・変える' }).click();
  await expect(page.getByRole('heading', { name: 'ワンちゃんの情報の変更' })).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'admin-dog-edit');
  await page.getByRole('button', { name: '登録をおやすみする' }).click();
  const rest = page.getByRole('dialog', { name: 'ワンちゃんの登録をおやすみする' });
  await expect(rest).toBeVisible();
  await shot(page, 'admin-dog-rest');
  await rest.getByRole('button', { name: 'やめる' }).click();

  // 無料券を使用済みにする(未使用の券があるおうち)
  const row = sql("SELECT household_id AS id FROM tickets WHERE status = 'unused' ORDER BY household_id LIMIT 1")[0]!;
  await page.goto(`/admin/households/${row.id as number}`);
  const tickets = page.getByRole('list', { name: '無料券' });
  await tickets.getByRole('button', { name: '使用済みにする' }).first().click();
  const use = page.getByRole('dialog', { name: '無料券を使用済みにする' });
  await expect(use).toBeVisible();
  await shot(page, 'admin-ticket-use');
  await use.getByRole('button', { name: 'やめる' }).click();
  await context.close();
});

test('管理者: おうちの統合', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  // 同じ家族が別々に登録した2つのおうち(ハナは同じ子)
  const a = await registerByApi(page, `U-manual-hana-1-${RUN}:はなママ`, [{ name: 'ハナ', breed: 'チワワ', size: 'small', sex: 'female', birthYm: '2021-04', variant: 9 }]);
  const b = await registerByApi(page, `U-manual-hana-2-${RUN}:はなパパ`, [
    { name: 'はな', breed: 'チワワ', size: 'small', sex: 'female', variant: 9 },
    { name: 'ゴロウ', breed: 'ミックス', size: 'medium', sex: 'male', birthYm: '2019-08', variant: 6 },
  ]);
  visitYesterday(a);
  visitYesterday(b);

  await adminLogin(page, 'admin');
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'おうちの統合' }).click();
  const picker1 = page.getByRole('group', { name: 'おうち1を探す' });
  await picker1.getByRole('searchbox', { name: '探す言葉' }).fill(a);
  await picker1.getByRole('list', { name: 'おうち1を探すの候補' }).getByRole('button', { name: new RegExp(a) }).click();
  const picker2 = page.getByRole('group', { name: 'おうち2を探す' });
  await picker2.getByRole('searchbox', { name: '探す言葉' }).fill(b);
  await picker2.getByRole('list', { name: 'おうち2を探すの候補' }).getByRole('button', { name: new RegExp(b) }).click();
  await expect(page.getByRole('radiogroup', { name: '残す会員ID' })).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'admin-merge');

  const pairing = page.getByRole('listitem', { name: 'はなの組み合わせ' });
  await pairing.getByRole('radio', { name: 'ハナ', exact: true }).check({ force: true });
  await scrollToTop(pairing, 80);
  await page.waitForTimeout(500);
  await shot(page, 'admin-merge-dogs');

  await page.getByRole('button', { name: 'まとめる', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'おうちをまとめる' });
  await expect(dialog).toBeVisible();
  await shot(page, 'admin-merge-confirm');
  await dialog.getByRole('button', { name: 'まとめる' }).click();
  await expect(adminToast(page, 'にまとめました')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'admin-merge-done');
  await context.close();
});

test('管理者: 確認待ち・旧カードの引き継ぎ', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  // 以前に LINE から届いていた引き継ぎの申請(いまは新しく届かない)。DR-000006 のおうち
  const key = `requests/DR-000006/manual-card.jpg`;
  putMedia(key, await paperCardPhoto(page, 6));
  insertMigrationRequest('DR-000006', { source: 'paper_card', claimedPoints: 6, note: '前のスタンプカードです' }, key);
  await adminLogin(page, 'admin', '/requests');
  await expect(page.getByRole('img', { name: '旧カードの写真' }).first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'admin-requests');

  // 受付で旧カードを見せてもらい、直接入力する(ももママ・DR-000004)
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '旧カードの引き継ぎ' }).click();
  const picker = page.getByRole('group', { name: '引き継ぐおうちを探す' });
  await picker.getByRole('searchbox', { name: '探す言葉' }).fill('DR-000004');
  await picker.getByRole('list', { name: '引き継ぐおうちを探すの候補' }).getByRole('button', { name: /DR-000004/ }).click();
  const section = page.getByRole('region', { name: '直接入力' });
  await section.getByRole('radio', { name: '紙のスタンプカード' }).check({ force: true });
  await section.getByLabel('旧カードのポイント数').fill('7');
  await section.getByLabel('旧カードを目で確かめた').check();
  await section.getByLabel('紙のカードは回収した(または使用済みの印を付けた)').check();
  await shot(page, 'admin-migration-direct');
  await section.getByRole('button', { name: '引き継ぐ' }).click();
  await page.getByRole('dialog', { name: '旧カードのポイントを引き継ぐ' }).getByRole('button', { name: '引き継ぐ' }).click();
  await expect(section.getByText(/ポイントを引き継ぎました/)).toBeVisible();
  await scrollToTop(page.getByRole('region', { name: '引き継ぎ済みの一覧' }), 120);
  await shot(page, 'admin-migration-list');
  await context.close();
});

test('管理者: 設定', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  await adminLogin(page, 'admin', '/settings');
  await expect(page.getByRole('region', { name: '施設の名前' }).getByLabel('施設の名前')).toHaveValue('グリーンドーム');
  await shot(page, 'admin-settings');
  await scrollToTop(page.getByRole('region', { name: /移行期間/ }), 24);
  await shot(page, 'admin-settings-migration');

  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '犬種' }).click();
  await expect(page.getByRole('list', { name: '犬種' }).getByRole('listitem', { name: 'プードル' })).toBeVisible();
  await shot(page, 'admin-breeds');

  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'アンケート' }).click();
  const add = page.getByRole('region', { name: '質問を追加' });
  await add.getByRole('radio', { name: 'おうちごと' }).click();
  await add.getByRole('radiogroup', { name: '答え方' }).getByRole('radio', { name: 'いくつでも選ぶ' }).click();
  await add.getByLabel('質問の文').fill('よく使うおやつ');
  await add.getByLabel('選択肢(1行に1つ)').fill('ジャーキー\nボーロ\nガム');
  await shot(page, 'admin-survey');

  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'スタッフ' }).click();
  await expect(page.getByText('田中').first()).toBeVisible();
  await shot(page, 'admin-staff');

  // 先月(初期データのイベントと臨時休業がある月)を見せる
  await page.goto('/admin/events');
  await page.getByRole('button', { name: '前の月' }).click();
  await page.waitForTimeout(800);
  await shot(page, 'admin-events');
  await context.close();
});

test('管理者: ダッシュボード', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  await adminLogin(page, 'admin', '/dashboard');
  await expect(page.getByRole('region', { name: '来場の推移' }).locator('canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, 'admin-dashboard');
  // グラフとイベントの効果は、過去3か月で見せる(今月はイベントがない日もあるため)
  await page.getByRole('radiogroup', { name: '期間' }).getByRole('radio', { name: '過去3か月' }).check({ force: true });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForTimeout(1000);
  await scrollToTop(page.getByRole('region', { name: '天気ごとの1日あたりの頭数' }), 24);
  await page.waitForTimeout(800);
  await shot(page, 'admin-dashboard-more');
  await scrollToTop(page.getByRole('region', { name: 'イベントの効果' }), 24);
  await page.waitForTimeout(800);
  await shot(page, 'admin-dashboard-events');
  await context.close();
});

test('管理者: 操作ログ・CSV・システムの状態・困ったとき', async ({ browser }) => {
  const context = await desktopContext(browser);
  const page = await context.newPage();
  await adminLogin(page, 'admin', '/audit');
  const list = page.getByRole('list', { name: '操作の一覧' });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await shot(page, 'admin-audit');
  const entry = list.getByRole('listitem').filter({ hasText: 'ハロウィン仮装の日の参加特典' }).first();
  await entry.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.getByRole('dialog', { name: '操作を元に戻す' })).toBeVisible();
  await shot(page, 'admin-audit-undo');
  await page.getByRole('dialog', { name: '操作を元に戻す' }).getByRole('button', { name: 'やめる' }).click();

  await page.goto('/admin/export');
  await expect(page.getByRole('button', { name: 'ダウンロード' })).toBeVisible();
  await shot(page, 'admin-export');

  await page.goto('/admin/status');
  await page.waitForTimeout(800);
  await shot(page, 'admin-status');

  await page.goto('/admin/help');
  await page.waitForTimeout(500);
  await shot(page, 'admin-help');
  await context.close();
});
