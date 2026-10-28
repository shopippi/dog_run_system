import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { adminCall, createStaff, dog, login, registerUser } from './helpers';

// A-08 まとめる申請の確認は、お客さんが招待から自分でまとめる形(C-12)になったため、なくなった。
// 以前の「まとめる申請」(requests の kind 'merge')の行は消さずに残すが、確認待ちには出さず、承認・却下もしない。

const NOW = '2026-10-28T03:00:00Z';

async function cookieOf(role: 'staff' | 'admin' | 'developer' = 'admin') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}

/** 以前の形の「まとめる申請」を直接入れる */
async function insertLegacyMergeRequest() {
  const papa = await registerUser('U001:パパ', [dog('アル')]);
  const mama = await registerUser('U002:ママ', [dog('あるくん')]);
  const res = await env.DB.prepare(
    `INSERT INTO requests (kind, household_id, related_household_id, requester_member_id, payload, status, created_at)
     SELECT 'merge', m.id, p.id, (SELECT id FROM family_members WHERE household_id = m.id), '{}', 'pending', '2026-10-27T10:00:00+09:00'
       FROM households m, households p WHERE m.member_no = ? AND p.member_no = ?`,
  )
    .bind(mama.memberNo, papa.memberNo)
    .run();
  return { papa, mama, requestId: res.meta.last_row_id };
}

describe('以前の「まとめる申請」', () => {
  it('確認待ちの一覧・件数・今日の来場の印には出ない。行は消さずに残る', async () => {
    const admin = await cookieOf();
    const { requestId } = await insertLegacyMergeRequest();
    const list = await adminCall('/admin/api/requests', { cookie: admin, now: NOW });
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ pending: 0, requests: [] });
    expect((await adminCall('/admin/api/requests?status=handled', { cookie: admin, now: NOW })).body.requests).toEqual([]);
    expect((await adminCall('/admin/api/requests/count', { cookie: admin })).body).toEqual({ pending: 0 });
    expect((await adminCall('/admin/api/today', { cookie: admin, now: NOW })).body.pendingRequests).toBe(0);
    const row = await env.DB.prepare('SELECT kind, status FROM requests WHERE id = ?').bind(requestId).first();
    expect(row).toEqual({ kind: 'merge', status: 'pending' });
  });

  it('承認・却下はできない(見つからない扱い)', async () => {
    const admin = await cookieOf();
    const { requestId } = await insertLegacyMergeRequest();
    const approve = await adminCall(`/admin/api/requests/${requestId}/approve`, { cookie: admin, body: { points: 1 }, now: NOW });
    expect(approve.status).toBe(404);
    const reject = await adminCall(`/admin/api/requests/${requestId}/reject`, { cookie: admin, body: { reason: 'その他' }, now: NOW });
    expect(reject.status).toBe(404);
    expect(reject.body.error.message).toMatch(/読み込み直してください/);
    const row = await env.DB.prepare('SELECT status FROM requests WHERE id = ?').bind(requestId).first();
    expect(row).toEqual({ status: 'pending' });
  });

  it('統合しても、以前の申請には触れない(管理者の統合は申請と関係なく使える)', async () => {
    const admin = await cookieOf();
    const { requestId } = await insertLegacyMergeRequest();
    const ids = await env.DB.prepare('SELECT id FROM households ORDER BY id').all<{ id: number }>();
    const [p, m] = ids.results;
    const res = await adminCall('/admin/api/merges', { cookie: admin, body: { keepHouseholdId: p!.id, absorbHouseholdId: m!.id }, now: NOW });
    expect(res.status).toBe(201);
    expect(await env.DB.prepare('SELECT status FROM requests WHERE id = ?').bind(requestId).first()).toEqual({ status: 'pending' });
    expect((await adminCall('/admin/api/requests/count', { cookie: admin })).body).toEqual({ pending: 0 });
  });
});
