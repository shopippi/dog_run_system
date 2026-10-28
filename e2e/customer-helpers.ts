import { expect, type APIRequestContext } from '@playwright/test';
import { checkinPassphrase } from './helpers';

// お客さん向けの残りの画面(担当E)のテストの準備。API を直接呼ぶ。

export function authHeaders(user: string) {
  const [id, name = ''] = user.split(':');
  return { authorization: `Bearer mock:${id}:${encodeURIComponent(name)}` };
}

/** API で過去の日にチェックインする(x-debug-now で日時を指定できるのはテストの環境だけ)。来場の番号を返す */
export async function checkinOn(request: APIRequestContext, user: string, date: string, useTicket = false): Promise<number> {
  const headers = authHeaders(user);
  const dogs = await request.get('/api/dogs', { headers });
  const dogIds = ((await dogs.json()) as { dogs: { id: number; status: string }[] }).dogs
    .filter((d) => d.status === 'active')
    .map((d) => d.id);
  const res = await request.post('/api/checkins', {
    headers: { ...headers, 'x-debug-now': `${date}T10:00:00+09:00` },
    data: { passphrase: checkinPassphrase(), dogIds, useTicket },
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
