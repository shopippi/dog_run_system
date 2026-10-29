import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { authHeaders, checkinOn } from './customer-helpers';
import { checkinPassphrase } from './helpers';

// 担当G(無料券の交換と使用・旧カードの引き継ぎ)の e2e で使う補助。

/** 前の日のチェックインを n 回して、ポイントをためる(2026-09-01 から1日ずつ) */
export async function earnPoints(request: APIRequestContext, user: string, n = 10) {
  for (let i = 1; i <= n; i++) await checkinOn(request, user, `2026-09-${String(i).padStart(2, '0')}`);
}

/** 今日(サーバーの今の日付)のチェックインを API で行う。来場の番号を返す */
export async function checkinToday(request: APIRequestContext, user: string): Promise<number> {
  const headers = authHeaders(user);
  const dogs = await request.get('/api/dogs', { headers });
  const dogIds = ((await dogs.json()) as { dogs: { id: number; status: string }[] }).dogs
    .filter((d) => d.status === 'active')
    .map((d) => d.id);
  const res = await request.post('/api/checkins', { headers, data: { passphrase: checkinPassphrase(), dogIds } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { visitId: number }).visitId;
}

/** 今日、無料券と交換する(API)。券の番号を返す */
export async function exchangeToday(request: APIRequestContext, user: string): Promise<number> {
  const res = await request.post('/api/tickets/exchange', { headers: authHeaders(user), data: {} });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { ticketId: number }).ticketId;
}

/** 管理画面のログインのまま、会員IDからおうちの番号を探す */
export async function householdIdOf(admin: Page, memberNo: string): Promise<number> {
  const res = await admin.request.get(`/admin/api/households?q=${encodeURIComponent(memberNo)}`);
  const { households } = (await res.json()) as { households: { id: number; memberNo: string }[] };
  return households.find((h) => h.memberNo === memberNo)!.id;
}

/**
 * 会員証の無料券を、指(マウス)で右へスライドする(C-06)。to は右端までの割合(1 で右端。途中で離す確かめに 0.5 など)。
 * scope は券の行(listitem)など、スライダーを含む範囲。
 */
export async function slideToUse(page: Page, scope: Locator | Page, to = 1) {
  const knob = scope.getByRole('slider', { name: 'スライドして使用する' }).first();
  await knob.scrollIntoViewIfNeeded();
  const k = (await knob.boundingBox())!;
  const t = (await knob.locator('..').boundingBox())!;
  const y = k.y + k.height / 2;
  const startX = k.x + k.width / 2;
  const endX = startX + (t.x + t.width - 4 - k.width / 2 - startX) * to;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
}
