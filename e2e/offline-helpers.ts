import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authHeaders } from './customer-helpers';
import { openCheckin, openLiff } from './helpers';

// 電波が弱い場所での動き(要件定義書 15.3)の e2e で使う補助。

/** API でお客さんを登録する(画面の登録より速い)。会員IDを返す */
export async function registerByApiQuick(request: APIRequestContext, user: string, dogNames: string[] = ['こむぎ']): Promise<string> {
  const headers = authHeaders(user);
  const breeds = ((await (await request.get('/api/breeds', { headers })).json()) as { breeds: { id: number; name: string }[] }).breeds;
  const poodle = breeds.find((b) => b.name === 'プードル')!.id;
  const res = await request.post('/api/register', {
    headers,
    data: {
      consent: true,
      dogs: dogNames.map((name) => ({ name, breedId: poodle, size: 'small' })),
      survey: [
        { questionId: 1, value: '40代' },
        { questionId: 2, value: '女性' },
        { questionId: 4, value: '知人の紹介' },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { memberNo: string }).memberNo;
}

/** 今日のチェックインの状態(API。画面の通信とは別の経路なので、電波を切っても読める) */
export async function todayStatus(request: APIRequestContext, user: string) {
  const res = await request.get('/api/checkins/today', { headers: authHeaders(user) });
  return (await res.json()) as { visit: { id: number } | null; balance: number };
}

/** Slow 3G 相当(下り・上り 400kbps、往復 400ms)にする */
export async function throttleSlow3g(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  return cdp;
}

/** 送信を待っているチェックインの画面を出す(電波を切って「チェックインする」を押す) */
export async function showWaitingCheckin(page: Page, context: BrowserContext, user: string) {
  await openCheckin(page, user);
  const button = page.getByRole('button', { name: 'チェックインする' });
  await button.waitFor();
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await button.click();
  await expect(page.getByText('電波が弱いため、送信を待っています。')).toBeVisible();
}

/** 前に開いたときの会員証を、最新にできなかった状態で出す */
export async function showStaleCard(page: Page, user: string) {
  await openLiff(page, user);
  await page.getByRole('region', { name: 'スタンプ' }).waitFor();
  await page.route(/\/api\/me$/, (route) => route.abort('internetdisconnected'));
  await openLiff(page, user);
  await expect(page.getByText('電波が弱いため、前に開いたときの内容です。')).toBeVisible({ timeout: 15_000 });
}

/** 画面のファイルを読めなかったときのエラーの境界を出す */
export async function showBoundary(page: Page, user: string) {
  await openLiff(page, user);
  await page.getByRole('region', { name: 'スタンプ' }).waitFor();
  await page.route(/\/assets\/HistoryPage-[^/]+\.js$/, (route) => route.abort('internetdisconnected'));
  await page.getByRole('link', { name: '来場履歴' }).click();
  await expect(page.getByRole('alert')).toContainText('画面を読み込めませんでした', { timeout: 15_000 });
}
