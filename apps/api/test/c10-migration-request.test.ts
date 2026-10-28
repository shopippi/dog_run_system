import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, fakeJpeg, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';

function form(fields: Record<string, string>, photo: Uint8Array | null = fakeJpeg(1200, 900)) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (photo) f.append('photo', new File([photo], 'card.jpg', { type: 'image/jpeg' }));
  return f;
}

const apply = (user: string, fields: Record<string, string>, photo?: Uint8Array | null, now?: string) =>
  call('/api/requests', { user, method: 'POST', body: form(fields, photo), now });

async function setPeriod(start: string | null, end: string | null) {
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('migration_period', ?, '2026-01-01T00:00:00+09:00')")
    .bind(JSON.stringify({ start, end }))
    .run();
}

describe('C-10 旧カードの引き継ぎ申請', () => {
  it('写真つきで申請すると、確認待ちの申請ができ、写真は会員IDの下に保存される', async () => {
    const r = await registerUser(PAPA);
    const res = await apply(PAPA, { source: 'line_card', claimedPoints: '7', note: '3年くらい使っていました' });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ source: 'line_card', claimedPoints: 7, note: '3年くらい使っていました', status: 'pending' });

    const row = await env.DB.prepare('SELECT kind, household_id, requester_member_id, payload, attachment_key, status FROM requests').first<{
      kind: string;
      payload: string;
      attachment_key: string;
      status: string;
      requester_member_id: number;
    }>();
    expect(row!.kind).toBe('migration');
    expect(row!.status).toBe('pending');
    expect(row!.requester_member_id).toBeGreaterThan(0);
    expect(JSON.parse(row!.payload)).toEqual({ source: 'line_card', claimedPoints: 7, note: '3年くらい使っていました' });
    expect(row!.attachment_key).toMatch(new RegExp(`^requests/${r.memberNo}/[0-9a-f-]{36}\\.jpg$`));
    const obj = await env.MEDIA.get(row!.attachment_key);
    expect(obj?.httpMetadata?.contentType).toBe('image/jpeg');
  });

  it('ポイント数は空(分からない)でも申請でき、全角の数字も読む', async () => {
    await registerUser(PAPA);
    const a = await apply(PAPA, { source: 'line_card', claimedPoints: '', note: '' });
    expect(a.status).toBe(201);
    expect(a.body.request).toMatchObject({ claimedPoints: null, note: null });
    const b = await apply(PAPA, { source: 'paper_card', claimedPoints: '１２' });
    expect(b.status).toBe(201);
    expect(b.body.request.claimedPoints).toBe(12);
  });

  it('ポイント数は0から99まで(境界値)', async () => {
    await registerUser(PAPA);
    expect((await apply(PAPA, { source: 'line_card', claimedPoints: '100' })).status).toBe(400);
    expect((await apply(PAPA, { source: 'line_card', claimedPoints: '-1' })).status).toBe(400);
    const bad = await apply(PAPA, { source: 'line_card', claimedPoints: '3.5' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/0から99まで/);
    expect((await apply(PAPA, { source: 'line_card', claimedPoints: '99' })).status).toBe(201);
    expect((await apply(PAPA, { source: 'paper_card', claimedPoints: '0' })).status).toBe(201);
  });

  it('移行元が選ばれていない・写真がないときは、日本語で理由を返す', async () => {
    await registerUser(PAPA);
    const noSource = await apply(PAPA, { claimedPoints: '3' });
    expect(noSource.status).toBe(400);
    expect(noSource.body.error.message).toMatch(/カード.*選んでください/);
    const noPhoto = await apply(PAPA, { source: 'line_card' }, null);
    expect(noPhoto.status).toBe(400);
    expect(noPhoto.body.error.message).toMatch(/写真がありません/);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM requests').first<{ n: number }>())!.n).toBe(0);
  });

  it('写真は長い辺 1200px・1MB まで(境界値)。JPEG 以外は受け付けない', async () => {
    await registerUser(PAPA);
    expect((await apply(PAPA, { source: 'line_card' }, fakeJpeg(1201, 800))).status).toBe(400);
    expect((await apply(PAPA, { source: 'line_card' }, new TextEncoder().encode('not a jpeg'))).status).toBe(400);
    const big = new Uint8Array(1_000_001);
    big.set(fakeJpeg(800, 600));
    expect((await apply(PAPA, { source: 'line_card' }, big)).status).toBe(400);
    expect((await apply(PAPA, { source: 'line_card' }, fakeJpeg(900, 1200))).status).toBe(201);
  });

  it('同じ移行元の2回目は「すでに申請済み」。家族が申請しても同じ', async () => {
    const r = await registerUser(PAPA);
    await env.DB.prepare(
      `INSERT INTO family_members (household_id, line_user_id, line_display_name, joined_at, join_method, status, updated_at)
       SELECT id, 'U002', 'ママ', '2026-01-01T00:00:00+09:00', 'invite', 'active', '2026-01-01T00:00:00+09:00' FROM households WHERE member_no = ?`,
    )
      .bind(r.memberNo)
      .run();
    expect((await apply(PAPA, { source: 'line_card' })).status).toBe(201);
    const again = await apply(MAMA, { source: 'line_card' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('migration_pending');
    expect(again.body.error.message).toMatch(/すでに申請済み/);
    // 別の移行元(紙のカード)は申請できる
    expect((await apply(MAMA, { source: 'paper_card' })).status).toBe(201);
  });

  it('承認済みの移行元は「すでに引き継ぎ済み」。却下された移行元は申請し直せる', async () => {
    await registerUser(PAPA);
    await apply(PAPA, { source: 'line_card' });
    await apply(PAPA, { source: 'paper_card' });
    await env.DB.prepare(
      "UPDATE requests SET status = 'approved', handled_at = '2026-10-29T10:00:00+09:00' WHERE json_extract(payload, '$.source') = 'line_card'",
    ).run();
    await env.DB.prepare("UPDATE requests SET status = 'rejected' WHERE json_extract(payload, '$.source') = 'paper_card'").run();
    const line = await apply(PAPA, { source: 'line_card' });
    expect(line.status).toBe(409);
    expect(line.body.error.code).toBe('migration_done');
    expect(line.body.error.message).toMatch(/すでに引き継ぎ済み/);
    expect((await apply(PAPA, { source: 'paper_card' })).status).toBe(201);
  });

  it('受付で直接入力して引き継いだ移行元も「すでに引き継ぎ済み」', async () => {
    const r = await registerUser(PAPA);
    await env.DB.prepare(
      `INSERT INTO point_ledger (household_id, delta, kind, migration_source, actor_type, actor_id, created_at)
       SELECT id, 6, 'migration', 'paper_card', 'staff', 1, '2026-10-28T10:00:00+09:00' FROM households WHERE member_no = ?`,
    )
      .bind(r.memberNo)
      .run();
    const res = await apply(PAPA, { source: 'paper_card' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('migration_done');
  });

  it('移行期間の外は受け付けない(期間の初日と最終日は受け付ける)', async () => {
    await registerUser(PAPA);
    await setPeriod('2026-11-01', '2026-12-31');
    const before = await apply(PAPA, { source: 'line_card' }, undefined, '2026-10-31T14:59:59Z'); // 10/31 23:59 JST
    expect(before.status).toBe(409);
    expect(before.body.error.code).toBe('migration_not_started');
    expect(before.body.error.message).toMatch(/11月1日から/);
    const list = await call('/api/requests', { user: PAPA, now: '2026-10-31T14:59:59Z' });
    expect(list.body.period).toEqual({ start: '2026-11-01', end: '2026-12-31', open: false, notStarted: true });
    expect((await apply(PAPA, { source: 'line_card' }, undefined, '2026-10-31T15:00:00Z')).status).toBe(201); // 11/1 0:00 JST
    expect((await apply(PAPA, { source: 'paper_card' }, undefined, '2026-12-31T14:59:59Z')).status).toBe(201); // 12/31 23:59 JST
  });

  it('移行期間が終わったあとは受け付けない', async () => {
    await registerUser(PAPA);
    await setPeriod('2026-11-01', '2026-12-31');
    const after = await apply(PAPA, { source: 'line_card' }, undefined, '2026-12-31T15:00:00Z'); // 1/1 0:00 JST
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe('migration_closed');
    expect(after.body.error.message).toMatch(/受付にお知らせください/);
    const list = await call('/api/requests', { user: PAPA, now: '2026-12-31T15:00:00Z' });
    expect(list.body.period).toEqual({ start: '2026-11-01', end: '2026-12-31', open: false, notStarted: false });
  });

  it('自分のおうちの申請の状態と、引き継いだポイントを返す(ほかのおうちの申請は見えない)', async () => {
    const r = await registerUser(PAPA);
    await registerUser('U900:よその人');
    await apply('U900:よその人', { source: 'line_card' });
    await apply(PAPA, { source: 'line_card', claimedPoints: '8' }, undefined, '2026-10-28T01:00:00Z');
    let list = await call('/api/requests', { user: PAPA });
    expect(list.status).toBe(200);
    expect(list.body.requests).toHaveLength(1);
    expect(list.body.requests[0]).toMatchObject({ source: 'line_card', claimedPoints: 8, status: 'pending', handledAt: null });
    expect(list.body.sources).toEqual([
      { source: 'line_card', state: 'pending', migratedPoints: null },
      { source: 'paper_card', state: 'none', migratedPoints: null },
    ]);
    expect(list.body.period).toEqual({ start: null, end: null, open: true, notStarted: false });

    // 管理者が承認して、7ポイントを台帳に入れた(A-05)
    await env.DB.batch([
      env.DB.prepare("UPDATE requests SET status = 'approved', handled_at = '2026-10-29T10:00:00+09:00' WHERE household_id = (SELECT id FROM households WHERE member_no = ?)").bind(r.memberNo),
      env.DB.prepare(
        `INSERT INTO point_ledger (household_id, delta, kind, migration_source, actor_type, actor_id, created_at)
         SELECT id, 7, 'migration', 'line_card', 'staff', 1, '2026-10-29T10:00:00+09:00' FROM households WHERE member_no = ?`,
      ).bind(r.memberNo),
    ]);
    list = await call('/api/requests', { user: PAPA });
    expect(list.body.requests[0]).toMatchObject({ status: 'approved', handledAt: '2026-10-29T10:00:00+09:00' });
    expect(list.body.sources[0]).toEqual({ source: 'line_card', state: 'done', migratedPoints: 7 });
  });

  it('未登録の人は申請できない', async () => {
    expect((await apply(PAPA, { source: 'line_card' })).status).toBe(409);
    expect((await call('/api/requests', { user: PAPA })).status).toBe(409);
  });

  it('LINE のログインがないと 401', async () => {
    expect((await call('/api/requests')).status).toBe(401);
  });
});
