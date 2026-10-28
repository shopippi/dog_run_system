import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, adminCall, call, createStaff, dog, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const NOW = '2026-10-28T01:00:00Z';

async function setup() {
  await createStaff('staff@example.com', 'staff');
  await createStaff('admin@example.com', 'admin');
  await createStaff('dev@example.com', 'developer');
  const r = await registerUser(PAPA);
  const id = (await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(r.memberNo).first<{ id: number }>())!.id;
  return {
    r,
    id,
    staff: await login('staff@example.com'),
    admin: await login('admin@example.com'),
    dev: await login('dev@example.com'),
  };
}
const inviteQr = (cookie: string, id: number, now = NOW) => adminCall(`/admin/api/households/${id}/invite-qr`, { cookie, body: {}, now });
const remove = (cookie: string, id: number, fid: number) =>
  adminCall(`/admin/api/households/${id}/family/${fid}`, { cookie, method: 'DELETE', now: NOW });
const memberId = async (lineUserId: string) =>
  (await env.DB.prepare('SELECT id FROM family_members WHERE line_user_id = ? ORDER BY id DESC').bind(lineUserId).first<{ id: number }>())!.id;
const join = (user: string, code: string, now = NOW) =>
  call(`/api/invites/${code}/accept`, {
    user,
    now,
    body: { consent: true, survey: [{ questionId: 1, value: '40代' }, { questionId: 2, value: '男性' }] },
  });

describe('A-06 受付での家族の追加', () => {
  it('10分間だけ使える招待を作り、QR の URL を返す。読み取った家族は「受付で追加」として参加する', async () => {
    const s = await setup();
    const res = await inviteQr(s.admin, s.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ url: `/liff/invite/${res.body.code}`, expiresAt: '2026-10-28T10:10:00+09:00', ttlMinutes: 10 });
    const inv = await env.DB.prepare('SELECT kind, created_by_staff_id FROM invites WHERE code = ?').bind(res.body.code).first();
    expect(inv).toEqual({ kind: 'reception', created_by_staff_id: 2 });

    const joined = await join(MAMA, res.body.code, '2026-10-28T01:09:00Z');
    expect(joined.status).toBe(201);
    const detail = await adminCall(`/admin/api/households/${s.id}`, { cookie: s.admin });
    expect(detail.body.family.map((m: any) => [m.name, m.joinMethodLabel])).toEqual(
      expect.arrayContaining([
        ['パパ', 'はじめに登録'],
        ['ママ', '受付で参加'],
      ]),
    );
    const log = await adminCall('/admin/api/audit', { cookie: s.admin });
    expect(log.body.entries[0]).toMatchObject({ actionLabel: '受付での家族の招待', target: { code: s.r.memberNo }, canUndo: false });
  });

  it('10分を過ぎた招待は使えない', async () => {
    const s = await setup();
    const res = await inviteQr(s.admin, s.id);
    const late = await join(MAMA, res.body.code, '2026-10-28T01:10:01Z');
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('invite_expired');
  });

  it('LIFF ID が設定されていれば、LINE の URL にする', async () => {
    const s = await setup();
    await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('liff_id', '"1234567890-AbCdEfGh"', '2026-10-01T00:00:00+09:00')`).run();
    const res = await inviteQr(s.admin, s.id);
    expect(res.body.url).toBe(`https://liff.line.me/1234567890-AbCdEfGh/invite/${res.body.code}`);
  });

  it('受付スタッフと製作者は 403。統合済みのおうちは 409', async () => {
    const s = await setup();
    expect((await inviteQr(s.staff, s.id)).status).toBe(403);
    expect((await inviteQr(s.dev, s.id)).status).toBe(403);
    await env.DB.prepare("UPDATE households SET status = 'merged' WHERE id = ?").bind(s.id).run();
    expect((await inviteQr(s.admin, s.id)).status).toBe(409);
  });
});

describe('A-06 家族を外す', () => {
  it('外した家族はおうちから抜け、ポイントはおうちに残る。最後の1人は外せない', async () => {
    const s = await setup();
    await addFamily(s.r.memberNo, 'U002', 'ママ');
    const res = await remove(s.admin, s.id, await memberId('U002'));
    expect(res.status).toBe(200);
    const me = await call('/api/me', { user: MAMA, now: NOW });
    expect(me.body.registered).toBe(false);
    const detail = await adminCall(`/admin/api/households/${s.id}`, { cookie: s.admin });
    expect(detail.body.family.find((m: any) => m.name === 'ママ')).toMatchObject({ status: 'left', statusLabel: '外れた', leftAt: '2026-10-28T10:00:00+09:00' });

    const last = await remove(s.admin, s.id, await memberId('U001'));
    expect(last.status).toBe(409);
    expect(last.body.error.message).toMatch(/最後の1人は外せません/);
    expect((await remove(s.admin, s.id, await memberId('U002'))).status).toBe(409);
  });

  it('操作ログから元に戻せる。本人がすでに別のおうちにいれば戻せない', async () => {
    const s = await setup();
    await addFamily(s.r.memberNo, 'U002', 'ママ');
    await remove(s.admin, s.id, await memberId('U002'));
    const log = await adminCall('/admin/api/audit', { cookie: s.admin });
    expect(log.body.entries[0]).toMatchObject({
      actionLabel: '家族を外す',
      target: { label: 'ママさん(アルのおうち)', code: s.r.memberNo, householdId: s.id },
      canUndo: true,
    });
    const id = log.body.entries[0].id;
    expect((await adminCall(`/admin/api/audit/${id}/undo`, { cookie: s.admin, body: {}, now: NOW })).status).toBe(200);
    expect((await call('/api/me', { user: MAMA, now: NOW })).body.household.memberNo).toBe(s.r.memberNo);

    // もう一度外し、ママが新しいおうちを作ったあとは戻せない
    await remove(s.admin, s.id, await memberId('U002'));
    await registerUser(MAMA, [dog('ニコ')]);
    const second = (await adminCall('/admin/api/audit?action=family.remove', { cookie: s.admin })).body.entries[0].id;
    const res = await adminCall(`/admin/api/audit/${second}/undo`, { cookie: s.admin, body: {}, now: NOW });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/別のおうちに入っているため/);
  });

  it('ほかのおうちの家族は 404。受付スタッフと製作者は 403', async () => {
    const s = await setup();
    await addFamily(s.r.memberNo, 'U002', 'ママ');
    const other = await registerUser('U003:ジジ', [dog('タロ')]);
    const otherId = (await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(other.memberNo).first<{ id: number }>())!.id;
    expect((await remove(s.admin, otherId, await memberId('U002'))).status).toBe(404);
    expect((await remove(s.staff, s.id, await memberId('U002'))).status).toBe(403);
    expect((await remove(s.dev, s.id, await memberId('U002'))).status).toBe(403);
  });
});
