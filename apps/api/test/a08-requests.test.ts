import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import '../src/routes/admin/requests';
import { getUndo, type AuditRow } from '../src/services/undo';
import { adminCall, call, createStaff, dog, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const NOW = '2026-10-28T03:00:00Z';

async function cookieOf(role: 'staff' | 'admin' | 'developer' = 'admin') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}

/** パパのおうちとママのおうち。ママがパパの招待を開いて、まとめる申請になった */
async function seedMergeRequest() {
  const papa = await registerUser(PAPA, [dog('アル')]);
  const mama = await registerUser(MAMA, [dog('あるくん')]);
  const invite = await call('/api/invites', { user: PAPA, body: {}, now: NOW });
  const accepted = await call(`/api/invites/${invite.body.code}/accept`, { user: MAMA, body: { consent: true, survey: [] }, now: NOW });
  expect(accepted.status).toBe(202);
  const req = await env.DB.prepare("SELECT id FROM requests WHERE kind = 'merge'").first<{ id: number }>();
  return { papa, mama, requestId: req!.id };
}

/** 旧カードの引き継ぎ申請(C-10 の形)を直接入れる */
async function insertMigrationRequest(memberNo: string, payload: unknown, attachmentKey: string | null = 'requests/DR-000001/card.jpg') {
  const res = await env.DB.prepare(
    `INSERT INTO requests (kind, household_id, requester_member_id, payload, attachment_key, status, created_at)
     SELECT 'migration', h.id, (SELECT id FROM family_members WHERE household_id = h.id ORDER BY id LIMIT 1), ?, ?, 'pending', '2026-10-28T11:00:00+09:00'
       FROM households h WHERE h.member_no = ?`,
  )
    .bind(JSON.stringify(payload), attachmentKey, memberNo)
    .run();
  return res.meta.last_row_id;
}

describe('A-08 まとめる申請の確認', () => {
  it('確認待ちの一覧に、種類・おうち・相手のおうち・申請した人・日時が出る', async () => {
    const admin = await cookieOf();
    const { papa, mama, requestId } = await seedMergeRequest();
    const migrationId = await insertMigrationRequest(papa.memberNo, { source: 'paper_card', claimedPoints: 7, note: '角が破れています' });

    const res = await adminCall('/admin/api/requests', { cookie: admin, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(2);
    expect(res.body.requests).toHaveLength(2);
    const merge = res.body.requests.find((r: { id: number }) => r.id === requestId);
    expect(merge).toMatchObject({
      kind: 'merge',
      status: 'pending',
      createdAt: '2026-10-28T12:00:00+09:00',
      household: { memberNo: mama.memberNo, displayName: 'あるくんのおうち', status: 'active' },
      related: { memberNo: papa.memberNo, displayName: 'アルのおうち' },
      requester: 'ママ',
      migration: null,
      attachmentUrl: null,
    });
    expect(merge.household.dogs).toEqual([{ id: mama.dogs[0]!.id, name: 'あるくん', breedName: 'トイプードル', thumbUrl: null }]);
    const migration = res.body.requests.find((r: { id: number }) => r.id === migrationId);
    expect(migration).toMatchObject({
      kind: 'migration',
      household: { memberNo: papa.memberNo },
      related: null,
      requester: 'パパ',
      migration: { source: 'paper_card', claimedPoints: 7, note: '角が破れています' },
      attachmentUrl: '/admin/api/media/requests/DR-000001/card.jpg',
    });
    // 件数(メニューの印)はそのまま使える
    expect((await adminCall('/admin/api/requests/count', { cookie: admin })).body).toEqual({ pending: 2 });
  });

  it('却下すると理由が残り、処理済みのタブに出る。操作ログから元に戻すと確認待ちに戻る', async () => {
    const admin = await cookieOf();
    const { requestId } = await seedMergeRequest();
    const empty = await adminCall(`/admin/api/requests/${requestId}/reject`, { cookie: admin, body: { reason: ' ' }, now: NOW });
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toMatch(/理由を選んでください/);

    const res = await adminCall(`/admin/api/requests/${requestId}/reject`, { cookie: admin, body: { reason: '同じ家族ではない' }, now: NOW });
    expect(res.status).toBe(200);
    expect((await adminCall('/admin/api/requests', { cookie: admin })).body.requests).toEqual([]);
    const handled = await adminCall('/admin/api/requests?status=handled', { cookie: admin });
    expect(handled.body.requests[0]).toMatchObject({
      id: requestId,
      status: 'rejected',
      handledBy: '管理者',
      handleNote: '同じ家族ではない',
      handledAt: '2026-10-28T12:00:00+09:00',
    });
    const again = await adminCall(`/admin/api/requests/${requestId}/reject`, { cookie: admin, body: { reason: 'その他' }, now: NOW });
    expect(again.status).toBe(409);

    const log = await env.DB.prepare("SELECT * FROM audit_log WHERE action = 'request.reject'").all<AuditRow>();
    expect(log.results).toHaveLength(1);
    expect(log.results[0]).toMatchObject({ target_type: 'request', target_id: String(requestId), reason: '同じ家族ではない' });
    await getUndo('request.reject')!(env.DB, log.results[0]!, { staffId: 1, now: new Date(NOW) });
    const back = await env.DB.prepare('SELECT status, handled_at, handle_note FROM requests WHERE id = ?').bind(requestId).first();
    expect(back).toEqual({ status: 'pending', handled_at: null, handle_note: null });
  });

  it('まとめる申請は承認のボタンでは承認しない(統合の画面でまとめると承認になる)', async () => {
    const admin = await cookieOf();
    const { requestId } = await seedMergeRequest();
    const res = await adminCall(`/admin/api/requests/${requestId}/approve`, { cookie: admin, body: {}, now: NOW });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/統合の画面に進む/);
  });

  it('確認待ちは管理者だけ。受付スタッフは 403、製作者は見るだけ', async () => {
    const { requestId } = await seedMergeRequest();
    const staff = await cookieOf('staff');
    expect((await adminCall('/admin/api/requests', { cookie: staff })).status).toBe(403);
    expect((await adminCall(`/admin/api/requests/${requestId}/reject`, { cookie: staff, body: { reason: 'その他' } })).status).toBe(403);
    const dev = await cookieOf('developer');
    expect((await adminCall('/admin/api/requests', { cookie: dev })).status).toBe(200);
    expect((await adminCall(`/admin/api/requests/${requestId}/reject`, { cookie: dev, body: { reason: 'その他' } })).status).toBe(403);
    const r = await env.DB.prepare('SELECT status FROM requests WHERE id = ?').bind(requestId).first();
    expect(r).toEqual({ status: 'pending' });
  });

  it('申請のおうちが統合済みなら、一覧でそれが分かる', async () => {
    const admin = await cookieOf();
    const { papa, mama, requestId } = await seedMergeRequest();
    const ids = await env.DB.prepare('SELECT id, member_no FROM households ORDER BY id').all<{ id: number; member_no: string }>();
    const [p, m] = ids.results;
    void papa;
    void mama;
    await adminCall('/admin/api/merges', { cookie: admin, body: { keepHouseholdId: p!.id, absorbHouseholdId: m!.id }, now: NOW });
    // 統合で、同じ2つのおうちの申請は承認になる
    const handled = await adminCall('/admin/api/requests?status=handled', { cookie: admin });
    expect(handled.body.requests[0]).toMatchObject({
      id: requestId,
      status: 'approved',
      household: { status: 'merged', mergedIntoMemberNo: p!.member_no },
    });
  });
});
