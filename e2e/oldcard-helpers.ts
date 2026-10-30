import { expect, request as pwRequest } from '@playwright/test';

// 旧カードの引き継ぎ(A-05、16章)の e2e で使う補助。

/**
 * 管理者として API で旧カードを引き継ぐ(画面を通さない準備用)。会員ID で探して入力する。
 * baseURL は playwright.config.ts と同じ(E2E_PORT)。
 */
export async function migrateViaApi(memberNo: string, body: Record<string, unknown>) {
  const baseURL = `http://localhost:${Number(process.env.E2E_PORT ?? 8788)}`;
  const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { 'x-dr-admin': '1' } });
  const login = await ctx.post('/admin/api/login', { data: { email: 'admin@example.com', password: 'e2e-password-1234' } });
  expect(login.status(), await login.text()).toBe(200);
  const search = await ctx.get(`/admin/api/households?q=${encodeURIComponent(memberNo)}`);
  const id = ((await search.json()) as { households: { id: number; memberNo: string }[] }).households.find((h) => h.memberNo === memberNo)!.id;
  // だれのカードか(省くと、初めの選択か最初の家族)
  const status = (await (await ctx.get(`/admin/api/households/${id}/migration`)).json()) as { defaultMemberId: number | null; members: { id: number }[] };
  const memberId = status.defaultMemberId ?? status.members[0]!.id;
  const res = await ctx.post(`/admin/api/households/${id}/migrate`, {
    data: { confirmed_card: true, collected_card: true, member_id: memberId, ...body },
  });
  expect(res.status(), await res.text()).toBe(201);
  await ctx.dispose();
}
