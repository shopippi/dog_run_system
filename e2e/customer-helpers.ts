import { expect, type APIRequestContext } from '@playwright/test';
import { checkinPassphrase } from './helpers';

// お客さん向けの残りの画面(担当E)のテストの準備。API を直接呼ぶ。

export function authHeaders(user: string) {
  const [id, name = ''] = user.split(':');
  return { authorization: `Bearer mock:${id}:${encodeURIComponent(name)}` };
}

/**
 * API で過去の日にチェックインする(x-debug-now で日時を指定できるのはテストの環境だけ)。来場の番号を返す。
 * useTicket のときは、チェックインの前にその日に無料券を使う(券がなければ、ポイントで交換してから使う。8章)
 */
export async function checkinOn(request: APIRequestContext, user: string, date: string, useTicket = false): Promise<number> {
  const headers = authHeaders(user);
  if (useTicket) await useTicketOn(request, user, date);
  const dogs = await request.get('/api/dogs', { headers });
  const dogIds = ((await dogs.json()) as { dogs: { id: number; status: string }[] }).dogs
    .filter((d) => d.status === 'active')
    .map((d) => d.id);
  const res = await request.post('/api/checkins', {
    headers: { ...headers, 'x-debug-now': `${date}T10:00:00+09:00` },
    data: { passphrase: checkinPassphrase(), dogIds },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { visitId: number }).visitId;
}

/** 受付スタッフとしてチェックインを取り消す(e2e/start-server.sh で作ったアカウント) */
export async function cancelVisit(request: APIRequestContext, visitId: number) {
  const adminHeaders = { 'x-dr-admin': '1' };
  const login = await request.post('/admin/api/login', {
    headers: adminHeaders,
    data: { email: 'staff@example.com', password: 'e2e-password-1234' },
  });
  expect(login.status()).toBe(200);
  const res = await request.post(`/admin/api/checkins/${visitId}/cancel`, { headers: adminHeaders, data: { reason: '入力ミス' } });
  expect(res.status(), await res.text()).toBe(200);
}

/** API で家族を招待し、joiner をそのおうちに参加させる(年代・性別の質問は id 1・2) */
export async function joinFamily(request: APIRequestContext, inviter: string, joiner: string) {
  const invite = await request.post('/api/invites', { headers: authHeaders(inviter), data: {} });
  expect(invite.status(), await invite.text()).toBe(201);
  const { code } = (await invite.json()) as { code: string };
  const res = await request.post(`/api/invites/${code}/accept`, {
    headers: authHeaders(joiner),
    data: { consent: true, survey: [{ questionId: 1, value: '40代' }, { questionId: 2, value: '男性' }] },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** API でその日に無料券と交換する(会員証の「無料券と交換する」)。券の番号を返す */
export async function exchangeOn(request: APIRequestContext, user: string, date: string): Promise<number> {
  const res = await request.post('/api/tickets/exchange', {
    headers: { ...authHeaders(user), 'x-debug-now': `${date}T09:30:00+09:00` },
    data: {},
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { ticketId: number }).ticketId;
}

/** API でその日に無料券を使う(会員証の「使用する」)。券がなければ交換してから使う。券の番号を返す */
export async function useTicketOn(request: APIRequestContext, user: string, date: string): Promise<number> {
  const headers = { ...authHeaders(user), 'x-debug-now': `${date}T09:40:00+09:00` };
  const me = (await (await request.get('/api/me', { headers })).json()) as { card: { tickets: { id: number }[] } };
  const id = me.card.tickets[0]?.id ?? (await exchangeOn(request, user, date));
  const res = await request.post(`/api/tickets/${id}/use`, { headers, data: {} });
  expect(res.status(), await res.text()).toBe(200);
  return id;
}
