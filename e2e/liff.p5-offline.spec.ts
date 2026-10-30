import { expect, test } from '@playwright/test';
import { newLineUser, openCheckin, openLiff } from './helpers';
import { liffShot } from './liff-shot';
import { registerByApiQuick, throttleSlow3g, todayStatus } from './offline-helpers';
import { checkinToday } from './tickets-helpers';

// 電波が弱い場所でも動くこと(要件定義書 15.3、docs/design.md 14章):
// 送信待ちのチェックイン・前に開いたときの会員証・画面ごとのエラーの境界・Slow 3G での読み込み

const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (process.env.SHOT_DIR) await liffShot(page, `${process.env.SHOT_DIR}/p5-offline/${name}.png`);
};

test.describe('送信待ちのチェックイン', () => {
  test('電波がないときに押すと「送信を待っています」になり、つながったら1回だけ送られて完了の画面になる', async ({ page, context, request }) => {
    const user = newLineUser('ママ');
    await registerByApiQuick(request, user, ['こむぎ', 'だいず']);
    await openCheckin(page, user);
    const button = page.getByRole('button', { name: 'チェックインする' });
    await button.waitFor();
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    await button.click();
    const waiting = page.getByRole('status').filter({ hasText: '電波が弱いため、送信を待っています。' });
    await expect(waiting).toBeVisible();
    await expect(waiting).toContainText('つながったら自動で送ります');
    // 届くまでは「チェックイン完了」を出さない
    await expect(page.getByRole('region', { name: 'チェックイン完了' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '送信を待っています…' })).toBeDisabled();
    expect((await todayStatus(request, user)).visit).toBeNull();
    await shot(page, '送信待ちのチェックイン');

    await context.setOffline(false);
    await expect(page.getByRole('region', { name: 'チェックイン完了' })).toBeVisible({ timeout: 20_000 });
    const after = await todayStatus(request, user);
    expect(after.visit).not.toBeNull();
    expect(after.balance).toBe(1);
  });

  test('送れないまま開き直しても、続きから送る(チェックインは1回だけ)', async ({ page, context, request }) => {
    const user = newLineUser('パパ');
    await registerByApiQuick(request, user, ['ニコ']);
    await openCheckin(page, user);
    const button = page.getByRole('button', { name: 'チェックインする' });
    await button.waitFor();
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    await button.click();
    await expect(page.getByText('電波が弱いため、送信を待っています。')).toBeVisible();

    // 電波は戻ったが、チェックインの送信だけはまだ届かない。そのまま会員証を開き直す
    await page.route('**/api/checkins', (route) => route.abort('internetdisconnected'));
    await context.setOffline(false);
    await openLiff(page, user);
    await expect(page.getByRole('button', { name: 'チェックインの送信を待っています' })).toBeVisible();
    expect((await todayStatus(request, user)).visit).toBeNull();

    // 届くようになったら、自動で送る。完了したことはトーストで知らせ、会員証が最新になる
    await page.unroute('**/api/checkins');
    await expect(page.getByRole('status').filter({ hasText: 'チェックインできました' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: '今日のチェックインを見る' })).toBeVisible();
    const after = await todayStatus(request, user);
    expect(after.visit).not.toBeNull();
    expect(after.balance).toBe(1);
  });

  test('「送るのをやめる」を押すと送らない', async ({ page, context, request }) => {
    const user = newLineUser('ママ');
    await registerByApiQuick(request, user, ['ココ']);
    await openCheckin(page, user);
    const button = page.getByRole('button', { name: 'チェックインする' });
    await button.waitFor();
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await button.click();
    await page.getByRole('button', { name: '送るのをやめる' }).click();
    await expect(page.getByRole('button', { name: 'チェックインする' })).toBeEnabled();
    await context.setOffline(false);
    await page.waitForTimeout(1500);
    expect((await todayStatus(request, user)).visit).toBeNull();
  });
});

test.describe('前に開いたときの会員証(stale-while-revalidate)', () => {
  test('2回目に開くと前の会員証がすぐ出て、「最新にしています…」のあと最新になる', async ({ page, request }) => {
    const user = newLineUser('ママ');
    const memberNo = await registerByApiQuick(request, user, ['こむぎ']);
    await openLiff(page, user);
    const stamps = page.getByRole('region', { name: 'スタンプ' });
    await expect(stamps.getByRole('img', { name: 'ポイント 0 / 10' })).toBeVisible();

    // ほかの端末でチェックインした(サーバーでは 1 ポイント)。会員証の情報は止めておく
    await checkinToday(request, user);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(/\/api\/me$/, async (route) => {
      await gate;
      await route.fallback();
    });
    await openLiff(page, user);
    // 止めているあいだも、前の会員証が出ている
    await expect(page.getByRole('region', { name: '会員証' }).getByText(memberNo)).toBeVisible();
    await expect(stamps.getByRole('img', { name: 'ポイント 0 / 10' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '最新にしています…' })).toBeVisible();
    await shot(page, '会員証_最新にしています');

    release();
    await expect(stamps.getByRole('img', { name: 'ポイント 1 / 10' })).toBeVisible();
    await expect(page.getByText('最新にしています…')).toHaveCount(0);
    await page.unroute(/\/api\/me$/);
  });

  test('最新にできないときは、前の会員証のまま「電波が弱いため、前に開いたときの内容です。」と出す', async ({ page, request }) => {
    const user = newLineUser('パパ');
    const memberNo = await registerByApiQuick(request, user, ['ニコ']);
    await openLiff(page, user);
    await page.getByRole('region', { name: '会員証' }).getByText(memberNo).waitFor();

    await page.route(/\/api\/me$/, (route) => route.abort('internetdisconnected'));
    await openLiff(page, user);
    await expect(page.getByRole('region', { name: '会員証' }).getByText(memberNo)).toBeVisible();
    const note = page.getByRole('status').filter({ hasText: '電波が弱いため、前に開いたときの内容です。' });
    await expect(note).toBeVisible({ timeout: 15_000 });
    // エラーの画面にはしない
    await expect(page.getByRole('alert')).toHaveCount(0);
    await shot(page, '会員証_前に開いたときの内容');

    await page.unroute(/\/api\/me$/);
    await note.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(note).toHaveCount(0);
  });

  test('端末に残すのは会員証の内容だけ。LINE の表示名やワンちゃんの詳しい情報は残さない', async ({ page, request }) => {
    const user = newLineUser('ママ');
    await registerByApiQuick(request, user, ['こむぎ']);
    await openLiff(page, user);
    await page.getByRole('region', { name: 'スタンプ' }).waitFor();
    const saved = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith('dr.card.')) out[k] = localStorage.getItem(k)!;
      }
      return out;
    });
    const keys = Object.keys(saved);
    expect(keys).toHaveLength(1);
    // キーは LINE のユーザーID そのものではない
    expect(keys[0]).not.toContain(user.split(':')[0]);
    const body = JSON.parse(saved[keys[0]!]!) as { me: { member: { lineDisplayName: string }; card: { dogs: { dogNo: string; weightKg: unknown }[] } } };
    expect(body.me.member.lineDisplayName).toBe('');
    expect(body.me.card.dogs[0]!.dogNo).toBe('');
    expect(JSON.stringify(body)).not.toContain('ママ');
  });
});

test.describe('画面ごとのエラーの境界', () => {
  test('画面のファイルを読めないときは、日本語の案内と「もう一度読み込む」を出し、押すと直る', async ({ page, request }) => {
    const user = newLineUser('ママ');
    await registerByApiQuick(request, user, ['こむぎ']);
    await openLiff(page, user);
    await page.getByRole('region', { name: 'スタンプ' }).waitFor();

    await page.route(/\/assets\/HistoryPage-[^/]+\.js$/, (route) => route.abort('internetdisconnected'));
    await page.getByRole('link', { name: '来場履歴' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('電波が弱いため、画面を読み込めませんでした。', { timeout: 15_000 });
    await expect(alert).toContainText('ポイントやチェックインの記録はなくなりません');
    await shot(page, 'エラーの境界_画面を読み込めない');

    await page.unroute(/\/assets\/HistoryPage-[^/]+\.js$/);
    await alert.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(page.getByRole('heading', { name: '来場履歴' })).toBeVisible();
  });

  test('表示の途中で失敗しても真っ白にせず、何が起きたかと次にすることを出す', async ({ page, request }) => {
    const user = newLineUser('パパ');
    await registerByApiQuick(request, user, ['ニコ']);
    // 会員証の情報が欠けた応答(サーバーの不具合のつもり)
    await page.route(/\/api\/me$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          registered: true,
          member: { id: 1, lineDisplayName: '' },
          household: { memberNo: 'DR-999999', displayName: 'テスト' },
          cardBackground: { kind: 'preset', color: 'ink' },
          card: { dogs: [], balance: 0, pointsPerTicket: 10, toNextTicket: 10, tickets: null, todayVisitId: null, todayPoints: 0, todayUsedTicketId: null },
        }),
      }),
    );
    await openLiff(page, user);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('画面をうまく表示できませんでした。');
    await expect(alert.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible();
    await shot(page, 'エラーの境界_表示に失敗');
    await page.unroute(/\/api\/me$/);
    await alert.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(page.getByRole('region', { name: 'スタンプ' })).toBeVisible();
  });
});

test.describe('Slow 3G(400kbps・往復 400ms)', () => {
  test('はじめて開いても会員証が 10 秒以内に出て、2回目は前の内容が 3 秒以内に出る', async ({ page, context, request }) => {
    test.setTimeout(90_000);
    const user = newLineUser('ママ');
    const memberNo = await registerByApiQuick(request, user, ['こむぎ', 'だいず']);
    await throttleSlow3g(context, page);
    const card = page.getByRole('region', { name: '会員証' }).getByText(memberNo);

    let t0 = Date.now();
    await openLiff(page, user);
    await card.waitFor({ timeout: 30_000 });
    const first = Date.now() - t0;

    t0 = Date.now();
    await page.reload();
    await card.waitFor({ timeout: 30_000 });
    const again = Date.now() - t0;
    test.info().annotations.push({ type: 'Slow 3G', description: `はじめて ${first}ms / 2回目 ${again}ms` });
    expect(first).toBeLessThan(10_000);
    expect(again).toBeLessThan(3_000);
  });
});
