import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { adminApiLogin, bookDaycareApi, dayAhead, markExperienced, registerApi, setOverride, showDateInCalendar } from './booking-helpers';
import { authHeaders, checkinOn, joinFamily } from './customer-helpers';
import { answerSurvey, makePhoto, newLineUser, openCheckin, openLiff } from './helpers';
import { liffShot } from './liff-shot';
import { sendInvite, sql } from './merge-helpers';
import { showBoundary, showStaleCard, showWaitingCheckin } from './offline-helpers';
import { slideToUse } from './tickets-helpers';
import { applyDevice, contextOptions, vqaDeviceList, VqaLog, type AuditOptions } from './visual-qa-helpers';

// お客さん向け(LIFF)の見え方の点検(重なり・切れ・はみ出し・押しにくさ・下の帯に隠れる・写真のつぶれ)。
// 長い呼び名・長い犬の名前・6頭・5桁のポイント・長いメモ・たくさんの予約で、全部の画面と状態を見る。
// ふだん(CI)は iPhone SE と「幅 320・文字 150%・ダーク」だけ。VQA_FULL=1 で全部の端末(VQA_DEVICES=se,i13 のように選べる)。
// VQA_SHOTS=ディレクトリ で、写真を <ディレクトリ>/<端末>/<画面>.png に保存する。

const LONG_HOUSE = 'アレキサンダー・エリザベス・ミケランジェロのおうち';
const LATIN_HOUSE = 'ChristophersonMaximilianWolfgangHouse';
const SIX_DOGS = ['マクシミリアンヌ・ド・ラ・モンターニュ', 'ジョセフィーヌ', 'Christophersonwolf', 'あんず', 'チョコレートクッキー', 'こむぎ'];

/** LIFF の画面で点検するときの決まり */
const LIFF_AUDIT: AuditOptions = {
  // 押せる大きさの例外: 会員証の右上の「背景を変える」は 44 の当たりを持つ。読み上げ用の隠した入力欄は点検しない
  ignore: ['.toast-region', '.stamp-grid'],
  // チェックイン完了の「+1ポイント」の横の肉球は、押したときのにじみ(inset -2px)が枠の外に少し出る
  // 会員証の呼び名は2行まで(design.md 5章。3行目からは … )
  allowClip: ['.done-points', '.mc-name'],
};

// CI: いちばん多い大きさ(iPhone SE)と、いちばん厳しい組み合わせ(幅 320・文字 150%・ダーク)
const devices = vqaDeviceList(['se', 'narrow-text150-dark']);

/**
 * 画面のキーボードが出たときと同じ動きにする(高さ 400 にしてから呼ぶ)。
 * 入力欄にフォーカスし、端末と同じように、その欄が見える所までスクロールする(scroll-padding を守る)。
 */
async function keyboardFocus(target: Locator) {
  await target.focus();
  await target.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
}

async function liffCheck(log: VqaLog, page: Page, name: string, opts: AuditOptions = {}) {
  await log.check(page, name, { ...LIFF_AUDIT, ...opts, shoot: (p) => liffShot(page, p) });
}

/** 名前の長いおうち(6頭・5桁のポイント・無料券・今日の来場・誕生月の子)を API で作る */
async function setupLongHousehold(request: APIRequestContext, user: string) {
  const u = await registerApi(request, user, SIX_DOGS.map((name, i) => ({ name, size: (['small', 'medium', 'large'] as const)[i % 3] })));
  const hid = sql(`SELECT id FROM households WHERE member_no = '${u.memberNo}'`)[0]!.id as number;
  await adminApiLogin(request, 'admin');
  const rn = await request.patch(`/admin/api/households/${hid}`, { headers: { 'x-dr-admin': '1' }, data: { displayName: LONG_HOUSE } });
  expect(rn.status(), await rn.text()).toBe(200);
  // 5桁のポイント(台帳に手動の記録を1行)
  sql(`INSERT INTO point_ledger (household_id, delta, kind, reason, actor_type, created_at) VALUES (${hid}, 12343, 'manual', 'その他', 'staff', strftime('%Y-%m-%dT09:00:00+09:00', 'now', '+9 hours', '-40 day'))`);
  for (let i = 1; i <= 3; i++) await checkinOn(request, user, `2026-09-${String(i).padStart(2, '0')}`);
  // 無料券を3枚(1枚は前に使った)
  for (let i = 0; i < 3; i++) {
    const r = await request.post('/api/tickets/exchange', { headers: authHeaders(user), data: {} });
    expect(r.status(), await r.text()).toBe(201);
  }
  // 誕生月の子(会員証の呼び名の下に一言)
  const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
  await request.patch(`/api/dogs/${u.dogs[1]!.id}`, { headers: authHeaders(user), data: { birthMonth: month.replace(/^\d{4}/, '2020') } });
  return { ...u, hid };
}

for (const d of devices) {
  test.describe(`見え方の点検 ${d.label}`, () => {
    test.use(contextOptions(d));
    test.beforeEach(async ({ page }) => {
      await applyDevice(page, d);
    });

    test('登録の流れ', async ({ page }) => {
      test.setTimeout(120_000);
      const log = new VqaLog(d.id);
      const user = newLineUser('Christopherson');
      await openLiff(page, user);
      await page.getByRole('heading', { name: 'はじめての方へ' }).waitFor();
      await liffCheck(log, page, 'L-01 同意');
      await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
      await page.getByRole('button', { name: '同意して次へ' }).click();
      const first = page.locator('fieldset.dog-form').nth(0);
      await first.getByLabel('名前').fill('マクシミリアンヌ・ド・ラ・モンターニュ');
      await first.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'バーニーズマウンテンドッグ' });
      await first.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 1200, 1600) });
      await first.locator('img.av').waitFor();
      await page.getByRole('button', { name: 'もう1頭追加する' }).click();
      const second = page.locator('fieldset.dog-form').nth(1);
      await second.getByLabel('名前').fill('Christophersonwolf');
      await second.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'その他' });
      await second.getByRole('textbox', { name: /犬種を入力/ }).fill('ラブラドゥードル');
      await second.getByRole('radio', { name: '大型' }).check();
      await second.locator('details.pf-more summary').click();
      await liffCheck(log, page, 'L-02 犬の登録');
      // 画面の下の方の入力欄にフォーカスし、キーボードが出たときの高さにする
      await page.setViewportSize({ width: d.viewport.width, height: 400 });
      await keyboardFocus(second.getByLabel('名前'));
      await log.check(page, 'L-02 犬の登録(キーボード・名前)', { ...LIFF_AUDIT, fullPage: false });
      await page.setViewportSize(d.viewport);
      await page.getByRole('button', { name: '次へ' }).click();
      await answerSurvey(page);
      await liffCheck(log, page, 'L-03 アンケート');
      await page.setViewportSize({ width: d.viewport.width, height: 400 });
      const lastInput = page.locator('main input[type=text]:visible, main input[inputmode]:visible, main textarea:visible').last();
      if (await lastInput.count()) {
        await keyboardFocus(lastInput);
        await log.check(page, 'L-03 アンケート(キーボード)', { ...LIFF_AUDIT, fullPage: false });
      }
      await page.setViewportSize(d.viewport);
      await page.getByRole('button', { name: '登録する' }).click();
      await page.getByText('登録が完了しました').waitFor();
      await liffCheck(log, page, 'L-04 登録完了');
      log.report();
      expect(log.problems).toEqual([]);
    });

    test('会員証(スタンプ・無料券・前のカード・誕生月)と使用', async ({ page, request }) => {
      test.setTimeout(150_000);
      const log = new VqaLog(d.id);
      const user = newLineUser('ママ');
      await setupLongHousehold(request, user);
      await openLiff(page, user);
      await page.getByRole('region', { name: 'スタンプ' }).waitFor();
      await expect(page.getByRole('region', { name: '会員証' })).toContainText(LONG_HOUSE);
      await liffCheck(log, page, 'L-07 会員証(長い呼び名・6頭・5桁)');
      await log.check(page, 'L-07 会員証(最初の画面)', { ...LIFF_AUDIT, fullPage: false });

      await page.getByRole('button', { name: /無料券と交換する/ }).click();
      await page.getByRole('dialog').waitFor();
      await liffCheck(log, page, 'L-07 交換の確認(シート)');
      await page.getByRole('dialog').getByRole('button', { name: '交換する', exact: true }).click();
      await page.locator('.toast').first().waitFor();
      await liffCheck(log, page, 'L-07 交換した(トースト)');
      await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);

      // 今日チェックイン → 今日のスタンプ
      await openCheckin(page, user);
      await page.getByRole('button', { name: 'チェックインする' }).waitFor();
      await liffCheck(log, page, 'L-05 チェックイン(6頭)');
      await page.setViewportSize({ width: d.viewport.width, height: 400 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await log.check(page, 'L-05 チェックイン(低い画面・いちばん下)', { ...LIFF_AUDIT, fullPage: false });
      await page.setViewportSize(d.viewport);
      await page.getByRole('button', { name: 'チェックインする' }).click();
      await page.getByRole('region', { name: 'チェックイン完了' }).waitFor();
      await liffCheck(log, page, 'L-06 チェックイン完了(6頭)');

      await openLiff(page, user);
      await page.getByRole('region', { name: 'スタンプ' }).waitFor();
      await liffCheck(log, page, 'L-07 会員証(今日のスタンプ・無料券あり)');

      const rows = page.getByRole('list', { name: '未使用の無料券' }).getByRole('listitem');
      await slideToUse(page, rows.first());
      await page.getByRole('region', { name: '無料券を使用できました' }).waitFor();
      await liffCheck(log, page, 'L-07 使用できました');
      await page.getByRole('link', { name: '会員証にもどる' }).click();
      await page.getByRole('link', { name: '今日使った無料券の画面を見る' }).waitFor();
      await liffCheck(log, page, 'L-07 会員証(今日使った券)');

      // 前に開いたときの会員証(最新にできなかった)
      await showStaleCard(page, user);
      await liffCheck(log, page, 'L-07 前に開いたときの会員証(最新にできない)');
      await page.unroute(/\/api\/me$/);
      // 最新にしているあいだ(遅い通信)
      await page.route(/\/api\/me$/, async (route) => {
        await new Promise((r) => setTimeout(r, 3000));
        await route.continue().catch(() => undefined);
      });
      await openLiff(page, user);
      await page.getByText('最新にしています…').waitFor();
      await log.check(page, 'L-07 前に開いたときの会員証(最新にしています)', { ...LIFF_AUDIT, fullPage: false });
      await page.unroute(/\/api\/me$/);
      log.report();
      expect(log.problems).toEqual([]);
    });

    test('電波が弱いとき(送信待ち・表示できない)', async ({ page, context, request }) => {
      test.setTimeout(90_000);
      const log = new VqaLog(d.id);
      const user = newLineUser('ママ');
      await registerApi(request, user, SIX_DOGS.slice(0, 3).map((name) => ({ name })));
      await showWaitingCheckin(page, context, user);
      await liffCheck(log, page, 'L-05 送信を待っているチェックイン');
      await page.getByRole('button', { name: '送るのをやめる' }).click();
      await context.setOffline(false);
      await showBoundary(page, user);
      await liffCheck(log, page, '画面を表示できなかったとき');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // まだ来場の記録がない子の変更画面(「まだ来場の記録はありません。…」の長い一文)
      await openLiff(page, user, '/dogs');
      await page.getByRole('link', { name: /Christophersonwolf/ }).click();
      await page.getByText('まだ来場の記録はありません').waitFor();
      await liffCheck(log, page, 'L-09 犬の変更(来場の記録なし)');
      log.report();
      expect(log.problems).toEqual([]);
    });

    test('来場履歴・ワンちゃん・おやすみ', async ({ page, request }) => {
      test.setTimeout(150_000);
      const log = new VqaLog(d.id);
      const user = newLineUser('ママ');
      await setupLongHousehold(request, user);
      await checkinOn(request, user, '2026-10-01', true);
      await openLiff(page, user, '/history');
      await page.getByRole('heading', { name: '来場履歴' }).waitFor();
      await page.locator('main li').first().waitFor();
      await liffCheck(log, page, 'L-08 来場履歴');

      await openLiff(page, user, '/dogs');
      await page.getByRole('heading', { name: 'ワンちゃん' }).waitFor();
      await liffCheck(log, page, 'L-09 ワンちゃん(6頭)');
      await page.getByRole('link', { name: /マクシミリアンヌ/ }).click();
      await page.getByRole('button', { name: '保存する' }).waitFor();
      await liffCheck(log, page, 'L-09 犬の変更(長い名前)');
      await log.check(page, 'L-09 犬の変更(最初の画面)', { ...LIFF_AUDIT, fullPage: false });
      await page.setViewportSize({ width: d.viewport.width, height: 400 });
      await keyboardFocus(page.getByLabel('名前'));
      await log.check(page, 'L-09 犬の変更(キーボード・名前)', { ...LIFF_AUDIT, fullPage: false });
      const weight = page.getByLabel('体重');
      if (await weight.count()) {
        await keyboardFocus(weight);
        await log.check(page, 'L-09 犬の変更(キーボード・体重)', { ...LIFF_AUDIT, fullPage: false });
      }
      await page.setViewportSize(d.viewport);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await log.check(page, 'L-09 犬の変更(いちばん下・おやすみ)', { ...LIFF_AUDIT, fullPage: false });
      await page.getByRole('button', { name: 'この子の登録をおやすみする' }).click();
      await page.getByRole('dialog').waitFor();
      await liffCheck(log, page, 'L-09 おやすみの確認(シート)');
      await page.getByRole('button', { name: 'おやすみする', exact: true }).click();
      await page.getByText('おやすみ中のワンちゃん').waitFor();
      await page.getByText('おやすみ中のワンちゃん').click();
      await liffCheck(log, page, 'L-09 ワンちゃん(おやすみ中を開いた)');

      await openLiff(page, user, '/dogs/new');
      await page.getByLabel('名前').waitFor();
      await page.getByLabel('名前').fill('Christophersonwolf');
      await liffCheck(log, page, 'L-09 ワンちゃんを追加');
      log.report();
      expect(log.problems).toEqual([]);
    });

    test('家族・招待・参加・まとめる', async ({ page, browser, request }) => {
      test.setTimeout(150_000);
      const log = new VqaLog(d.id);
      const mama = newLineUser('ママ');
      await setupLongHousehold(request, mama);
      await joinFamily(request, mama, newLineUser('MaximilianAlexander'));
      await openLiff(page, mama, '/family');
      await page.getByRole('region', { name: 'いまの家族' }).getByRole('listitem').nth(1).waitFor();
      await liffCheck(log, page, 'L-11 家族を招待');
      await page.getByRole('button', { name: '招待のQRコードを表示する' }).click();
      await page.getByRole('img', { name: '家族の招待のQRコード' }).waitFor();
      await liffCheck(log, page, 'L-11 招待のQRコード');
      await page.getByRole('button', { name: 'このおうちから抜ける' }).click();
      await page.getByRole('dialog').waitFor();
      await liffCheck(log, page, 'L-11 抜ける(シート)');
      await page.getByRole('dialog').getByRole('button', { name: 'やめる' }).click();

      const invitePath = await sendInvite(page, mama);
      const ctx2 = await browser.newContext({ ...contextOptions(d), locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce', baseURL: test.info().project.use.baseURL });
      const p2 = await ctx2.newPage();
      await applyDevice(p2, d);
      await openLiff(p2, newLineUser('パパ'), invitePath);
      await p2.getByRole('button', { name: '参加する' }).waitFor();
      await liffCheck(log, p2, 'L-12 招待を受けたとき');

      // すでに別のおうちがある人(まとめる)
      const other = newLineUser(LATIN_HOUSE);
      await registerApi(request, other, [{ name: 'Christophersonwolf' }, { name: 'こむぎ' }]);
      await openLiff(p2, other, invitePath);
      await expect(p2.getByRole('heading', { name: 'おうちを一つにまとめる' })).toBeVisible();
      await liffCheck(log, p2, 'L-12 おうちを一つにまとめる');
      await p2.getByRole('group', { name: /Christophersonwolfの同じ子/ }).getByRole('radio').first().check();
      await p2.getByRole('button', { name: 'まとめる', exact: true }).click();
      await expect(p2.getByRole('heading', { name: 'まとめてよいですか?' })).toBeVisible();
      await liffCheck(log, p2, 'L-12 まとめる(確認)');
      await p2.getByRole('button', { name: 'まとめる', exact: true }).click();
      await expect(p2.getByRole('heading', { name: 'おうちが一つになりました' })).toBeVisible();
      await liffCheck(log, p2, 'L-12 おうちが一つになりました');
      await ctx2.close();
      log.report();
      expect(log.problems).toEqual([]);
    });

    test('プロフィール・アンケート・背景・使い方', async ({ page, request }) => {
      test.setTimeout(120_000);
      const log = new VqaLog(d.id);
      const user = newLineUser('ママ');
      await setupLongHousehold(request, user);
      await openLiff(page, user);
      await page.locator('.pf-nudge').waitFor();
      await openLiff(page, user, '/profile');
      await page.getByRole('heading', { name: 'プロフィール' }).waitFor();
      await liffCheck(log, page, 'L-10 プロフィール');
      await page.setViewportSize({ width: d.viewport.width, height: 400 });
      await keyboardFocus(page.getByLabel('お住まいの郵便番号'));
      await log.check(page, 'L-10 プロフィール(キーボード・郵便番号)', { ...LIFF_AUDIT, fullPage: false });
      const lastText = page.locator('main input[type=text]:visible, main input[inputmode]:visible, main textarea:visible').last();
      await keyboardFocus(lastText);
      await log.check(page, 'L-10 プロフィール(キーボード・いちばん下の入力欄)', { ...LIFF_AUDIT, fullPage: false });
      await page.setViewportSize(d.viewport);
      await page.getByLabel('お住まいの郵便番号').fill('1234567');
      await page.getByRole('button', { name: '保存する' }).click();
      await page.locator('.toast').first().waitFor();
      await liffCheck(log, page, 'L-10 プロフィール(保存のトースト)');

      await openLiff(page, user, '/card/background');
      await page.getByRole('heading', { name: '会員証の背景' }).waitFor();
      await liffCheck(log, page, 'L-07b 背景を変える');
      await page.getByRole('radio', { name: '砂' }).check({ force: true });
      await expect(page.getByRole('status')).toHaveText('保存しました');
      await liffCheck(log, page, 'L-07b 背景を変える(砂)');

      await openLiff(page, user, '/help');
      await page.getByRole('heading', { name: '使い方・よくある質問' }).waitFor();
      for (const s of await page.locator('main details summary').all()) await s.click();
      await liffCheck(log, page, '使い方・よくある質問(全部開いた)');
      log.report();
      expect(log.problems).toEqual([]);
    });

    test('予約(流れ・カレンダー・確認・一覧・内容・キャンセル)', async ({ page, request }) => {
      test.setTimeout(180_000);
      const log = new VqaLog(d.id);
      const user = newLineUser('ママ');
      const u = await setupLongHousehold(request, user);
      await markExperienced(request, u.dogs[0]!.id);
      // 予約の受け入れ数がほかのテストとまざらないよう、使う日の頭数を多めにしておく
      const base = 46 + (Math.max(0, devices.indexOf(d)) % 3);
      for (const n of [0, 1, 2, 3, 4, 5, 6, 10, 11, 12]) {
        for (const service of ['daycare', 'boarding']) {
          await setOverride(request, { date: dayAhead(base + n), service, caps: { small: 100, medium: 100, large: 100 } });
        }
      }
      // たくさんの予約(長いメモ)
      for (let i = 0; i < 6; i++) {
        await bookDaycareApi(request, user, [u.dogs[i % 6]!.id], dayAhead(base + 1 + i), {
          note: 'ごはんは朝と夕方に1回ずつ。お薬を1日1回。マクシミリアンヌ・ド・ラ・モンターニュは雷が苦手なので、静かな部屋でお願いします。'.repeat(2).slice(0, 200),
        });
      }
      await openLiff(page, user, '/bookings');
      await page.getByRole('region', { name: 'これからの予約' }).waitFor();
      await liffCheck(log, page, 'L-15 予約の一覧(たくさん)');

      await page.getByRole('button', { name: '予約する' }).click();
      await page.getByRole('heading', { name: '予約する' }).waitFor();
      for (const n of SIX_DOGS) await page.getByRole('checkbox', { name: new RegExp(n.slice(0, 6)) }).check();
      await liffCheck(log, page, 'L-14 予約する(種類と6頭)');
      await page.getByRole('button', { name: '日にちを選ぶ' }).click();
      const date = dayAhead(base);
      await (await showDateInCalendar(page, date)).waitFor();
      await liffCheck(log, page, 'L-14 空きのカレンダー');
      await page.locator(`.bk-cal-cell[data-date="${date}"]`).click();
      await liffCheck(log, page, 'L-14 日にちと時刻');
      await page.getByRole('button', { name: '次へ' }).click();
      await page.getByLabel('お店へのメモ').fill('ごはんは朝と夕方に1回ずつ。マクシミリアンヌは1日1回お薬を飲みます。Christophersonwolfは雷が苦手です。'.repeat(3));
      for (const box of await page.locator('.bk-check input[type=checkbox]').all()) await box.check();
      await liffCheck(log, page, 'L-14 メモと確かめること');
      await page.setViewportSize({ width: d.viewport.width, height: 400 });
      await keyboardFocus(page.getByLabel('お店へのメモ'));
      await log.check(page, 'L-14 メモ(キーボード)', { ...LIFF_AUDIT, fullPage: false });
      await page.setViewportSize(d.viewport);
      await page.getByRole('button', { name: '内容を確かめる' }).click();
      await page.getByRole('region', { name: '料金の目安' }).waitFor();
      await liffCheck(log, page, 'L-14 内容の確認と料金の目安');
      await page.getByRole('button', { name: '予約する', exact: true }).click();
      await page.locator('.bk-detail-title .badge').waitFor();
      await liffCheck(log, page, 'L-15 予約の内容');
      await page.getByRole('button', { name: 'この予約をキャンセルする' }).click();
      await page.getByRole('dialog').waitFor();
      await liffCheck(log, page, 'L-15 キャンセルの確認(シート)');

      // お泊まり
      await openLiff(page, user, '/bookings/new');
      await page.getByRole('radio', { name: 'お泊まり' }).check();
      await page.getByRole('checkbox', { name: /ジョセフィーヌ/ }).check();
      await page.getByRole('button', { name: '日にちを選ぶ' }).click();
      await (await showDateInCalendar(page, dayAhead(base + 10))).click();
      await (await showDateInCalendar(page, dayAhead(base + 12))).click();
      await liffCheck(log, page, 'L-14 お泊まりの日にち');
      log.report();
      expect(log.problems).toEqual([]);
    });
  });
}

