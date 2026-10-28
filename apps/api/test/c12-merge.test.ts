import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, adminCall, call, checkin, createStaff, dog, fakeJpeg, givePoints, login, registerUser } from './helpers';

// C-12 お客さん同士でおうちをまとめる(要件定義書 5.1・5.3)。
// すでに別のおうちを持つ人が招待を開くと、本人の確認だけでその場でまとめる。処理は管理者の統合(A-07)と同じ。

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const BAABA = 'U003:ばあば';
const NOW = '2026-10-28T03:00:00Z';

const me = (user: string, now = NOW) => call('/api/me', { user, now });
async function householdIdOf(memberNo: string) {
  const r = await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(memberNo).first<{ id: number }>();
  return r!.id;
}
async function invite(user = PAPA, now = NOW) {
  const res = await call('/api/invites', { user, body: {}, now });
  return res.body.code as string;
}
async function setPhoto(user: string, dogId: number) {
  const form = new FormData();
  form.append('photo', new File([fakeJpeg(800, 600)], 'p.jpg', { type: 'image/jpeg' }));
  form.append('thumb', new File([fakeJpeg(240, 240)], 't.jpg', { type: 'image/jpeg' }));
  const res = await call(`/api/dogs/${dogId}/photo`, { user, body: form });
  expect(res.status).toBe(200);
  const row = await env.DB.prepare('SELECT photo_key FROM dogs WHERE id = ?').bind(dogId).first<{ photo_key: string }>();
  return row!.photo_key;
}
async function adminCookie() {
  await createStaff('admin@example.com', 'admin');
  return login('admin@example.com');
}

/**
 * パパのおうち(アル、7ポイント、10/1 に来場)と、ママのおうち(あるくん・モカ、5ポイント、10/2 に来場)。
 * users を変えると、同じ形のおうちを別の人で作る(管理者の統合と比べるため)。
 */
async function seed(users: [string, string] = [PAPA, MAMA]) {
  const [p, m] = users;
  const papa = await registerUser(p, [dog('アル')]);
  const mama = await registerUser(m, [dog('あるくん', { breedId: 5, size: 'medium', sex: 'male' }), dog('モカ')]);
  await checkin(p, [papa.dogs[0]!.id], { now: '2026-10-01T01:00:00Z' });
  await checkin(m, [mama.dogs[0]!.id, mama.dogs[1]!.id], { now: '2026-10-02T01:00:00Z' });
  await givePoints(papa.memberNo, 6);
  await givePoints(mama.memberNo, 4);
  return { papa, mama, keepId: await householdIdOf(papa.memberNo), absorbId: await householdIdOf(mama.memberNo) };
}

describe('C-12 お客さん同士でおうちをまとめる', () => {
  it('別のおうちの家族が招待を開くと、まとめた後の下見(残る会員ID・ポイントの合計・来場・家族・両方のワンちゃん)が出る。計算は管理者の統合と同じ', async () => {
    const admin = await adminCookie();
    const { papa, mama, keepId, absorbId } = await seed();
    await addFamily(mama.memberNo, 'U003', 'ばあば');
    const code = await invite();
    const res = await call(`/api/invites/${code}`, { user: MAMA, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'valid', viewer: 'other', inviterName: 'パパ' });
    const merge = res.body.merge;
    expect(merge.theirs).toMatchObject({ memberNo: papa.memberNo, displayName: 'アルのおうち', points: 7, visits: 1, family: ['パパ'] });
    expect(merge.mine).toMatchObject({ memberNo: mama.memberNo, displayName: 'あるくん・モカのおうち', points: 5, visits: 1, family: ['ママ', 'ばあば'] });
    expect(merge.theirs.dogs).toEqual([{ id: papa.dogs[0]!.id, name: 'アル', breedName: 'トイプードル', thumbUrl: null, hasPhoto: false }]);
    expect(merge.mine.dogs.map((d: { name: string }) => d.name)).toEqual(['あるくん', 'モカ']);
    // 一緒に移る家族(自分以外)
    expect(merge.movingFamily).toEqual(['ばあば']);
    expect(merge.result.family).toEqual(['パパ', 'ママ', 'ばあば']);

    // 管理者の統合の確認(services/merges.ts)と同じ結果
    const admin1 = await adminCall('/admin/api/merges/preview', {
      cookie: admin,
      body: { keepHouseholdId: keepId, absorbHouseholdId: absorbId },
      now: NOW,
    });
    expect(merge.result).toEqual({
      memberNo: admin1.body.result.memberNo,
      displayName: admin1.body.result.displayName,
      points: admin1.body.result.points,
      tickets: admin1.body.result.tickets,
      ticketsIssued: admin1.body.result.ticketsIssued,
      visits: admin1.body.result.visits,
      family: ['パパ', 'ママ', 'ばあば'],
    });
    expect(merge.result.memberNo).toBe(papa.memberNo);
    expect(merge.result.points + merge.result.ticketsIssued * 10).toBe(12);

    // はじめての人や、同じおうちの家族には下見は出ない。下見ではデータは変わらない
    expect((await call(`/api/invites/${code}`, { user: 'U009:だれか', now: NOW })).body.merge).toBeNull();
    expect((await call(`/api/invites/${code}`, { user: PAPA, now: NOW })).body.merge).toBeNull();
    expect((await me(MAMA)).body.household.memberNo).toBe(mama.memberNo);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM merges').first<{ n: number }>())!.n).toBe(0);
  });

  it('自分のワンちゃんの写真は自分のおうちの写真の URL、招待した側は招待の写真の URL で見られる', async () => {
    const { papa, mama } = await seed();
    await setPhoto(PAPA, papa.dogs[0]!.id);
    await setPhoto(MAMA, mama.dogs[0]!.id);
    const code = await invite();
    const { merge } = (await call(`/api/invites/${code}`, { user: MAMA, now: NOW })).body;
    const theirs = merge.theirs.dogs[0];
    const mine = merge.mine.dogs[0];
    expect(theirs).toMatchObject({ hasPhoto: true, thumbUrl: `/api/invites/${code}/photos/${papa.dogs[0]!.id}` });
    expect(mine.hasPhoto).toBe(true);
    expect(mine.thumbUrl).toMatch(/^\/api\/media\/dogs\//);
    expect(merge.mine.dogs[1]).toMatchObject({ hasPhoto: false, thumbUrl: null });
    expect((await call(theirs.thumbUrl, { user: MAMA, now: NOW })).status).toBe(200);
    expect((await call(mine.thumbUrl, { user: MAMA, now: NOW })).status).toBe(200);
  });

  it('「まとめる」で、その場で一つのおうちになる。結果は管理者の統合と同じで、操作ログにはお客さんの操作として残る', async () => {
    const admin = await adminCookie();
    // 1組目はお客さんがまとめ、2組目は管理者がまとめる(同じ形のおうち)
    const a = await seed([PAPA, MAMA]);
    const b = await seed(['U011:パパ2', 'U012:ママ2']);
    const code = await invite();
    const res = await call(`/api/invites/${code}/merge`, {
      user: MAMA,
      now: NOW,
      body: { dogs: [{ dogId: a.mama.dogs[0]!.id, sameAs: a.papa.dogs[0]!.id, keepPhoto: 'theirs' }] },
    });
    expect(res.status).toBe(201);
    const byAdmin = await adminCall('/admin/api/merges', {
      cookie: admin,
      body: { keepHouseholdId: b.keepId, absorbHouseholdId: b.absorbId, dogPairs: [{ keep: b.papa.dogs[0]!.id, absorb: b.mama.dogs[0]!.id, take: 'keep' }] },
      now: NOW,
    });
    expect(byAdmin.status).toBe(201);
    expect(res.body).toEqual({
      memberNo: a.papa.memberNo,
      householdName: byAdmin.body.displayName,
      points: byAdmin.body.points,
      tickets: byAdmin.body.tickets,
      ticketsIssued: byAdmin.body.ticketsIssued,
    });

    // ママの会員証は、パパと同じ会員ID・ポイント・ワンちゃんになる
    const p = (await me(PAPA)).body;
    const m = (await me(MAMA)).body;
    expect(m.household).toEqual(p.household);
    expect(m.card.balance).toBe(p.card.balance);
    expect(m.card.dogs.map((d: { id: number; name: string }) => [d.id, d.name])).toEqual([
      [a.papa.dogs[0]!.id, 'アル'],
      [a.mama.dogs[1]!.id, 'モカ'],
    ]);
    // 管理者の統合と、台帳・来場・犬・おうちの状態が同じ形になる
    const shape = async (keepId: number, absorbId: number) => ({
      households: await env.DB.prepare('SELECT status, merged_into_id = ? AS into_kept FROM households WHERE id IN (?, ?) ORDER BY id')
        .bind(keepId, keepId, absorbId)
        .all()
        .then((r) => r.results),
      ledger: await env.DB.prepare(
        `SELECT household_id = ? AS kept, delta, kind FROM point_ledger WHERE merge_id IS NOT NULL AND household_id IN (?, ?) ORDER BY id`,
      )
        .bind(keepId, keepId, absorbId)
        .all()
        .then((r) => r.results),
      visits: await env.DB.prepare('SELECT household_id = ? AS kept, visit_date FROM visits WHERE household_id IN (?, ?) ORDER BY visit_date')
        .bind(keepId, keepId, absorbId)
        .all()
        .then((r) => r.results),
      dogs: await env.DB.prepare('SELECT household_id = ? AS kept, status, name FROM dogs WHERE household_id IN (?, ?) ORDER BY id')
        .bind(keepId, keepId, absorbId)
        .all()
        .then((r) => r.results),
    });
    expect(await shape(a.keepId, a.absorbId)).toEqual(await shape(b.keepId, b.absorbId));

    // 操作ログ: お客さんの操作として、まとめた人(ママ)が残る
    const log = await env.DB.prepare(
      "SELECT actor_type, actor_id, target_type, reason, after_value FROM audit_log WHERE action = 'household.merge' ORDER BY id LIMIT 1",
    ).first<{ actor_type: string; actor_id: number; target_type: string; reason: string; after_value: string }>();
    const mamaMember = await env.DB.prepare("SELECT id FROM family_members WHERE line_user_id = 'U002'").first<{ id: number }>();
    expect(log).toMatchObject({ actor_type: 'member', actor_id: mamaMember!.id, target_type: 'merge' });
    expect(log!.reason).toBe(`${a.mama.memberNo} を ${a.papa.memberNo} にまとめた(お客さんの操作)`);
    expect(JSON.parse(log!.after_value)).toMatchObject({ byCustomer: true });
    const ledgerActors = await env.DB.prepare(
      'SELECT DISTINCT actor_type, actor_id FROM point_ledger WHERE merge_id = (SELECT MIN(id) FROM merges)',
    ).all();
    expect(ledgerActors.results).toEqual([{ actor_type: 'member', actor_id: mamaMember!.id }]);
    const merges = await env.DB.prepare('SELECT executed_by_staff_id, executed_by_member_id, invite_id FROM merges ORDER BY id').all();
    expect(merges.results[0]).toMatchObject({ executed_by_staff_id: null, executed_by_member_id: mamaMember!.id });
    expect(merges.results[1]).toMatchObject({ executed_by_staff_id: 1, executed_by_member_id: null, invite_id: null });

    // 管理画面の操作ログと統合の記録には「ママさん(お客さん)」と出る
    const audit = await adminCall('/admin/api/audit?action=household.merge', { cookie: admin, now: NOW });
    const entry = audit.body.entries.find((e: { actorName: string }) => e.actorName === 'ママさん(お客さん)');
    expect(entry).toMatchObject({ actionLabel: 'おうちをまとめる', canUndo: true });
    const record = await adminCall(`/admin/api/merges?householdId=${a.keepId}`, { cookie: admin, now: NOW });
    expect(record.body.merges[0]).toMatchObject({ executedBy: 'ママさん(お客さん)', undoStatus: 'ok' });

    // 招待は使い切り
    const inv = await env.DB.prepare('SELECT used_at, used_by_member_id FROM invites WHERE code = ?').bind(code).first();
    expect(inv).toEqual({ used_at: '2026-10-28T12:00:00+09:00', used_by_member_id: mamaMember!.id });
    const again = await call(`/api/invites/${code}`, { user: 'U020:だれか', now: NOW });
    expect(again.body.status).toBe('used');
  });

  it('同じ子を選ぶと1頭にまとまる。名前と犬種は招待した側のまま、写真は選んだ方を残す', async () => {
    const { papa, mama } = await seed();
    const theirsKey = await setPhoto(PAPA, papa.dogs[0]!.id);
    const mineKey = await setPhoto(MAMA, mama.dogs[0]!.id);
    expect(theirsKey).not.toBe(mineKey);
    const code = await invite();
    const res = await call(`/api/invites/${code}/merge`, {
      user: MAMA,
      now: NOW,
      body: { dogs: [{ dogId: mama.dogs[0]!.id, sameAs: papa.dogs[0]!.id, keepPhoto: 'mine' }, { dogId: mama.dogs[1]!.id, sameAs: null }] },
    });
    expect(res.status).toBe(201);
    const al = await env.DB.prepare('SELECT name, breed_id, size, sex, photo_key, status FROM dogs WHERE id = ?').bind(papa.dogs[0]!.id).first();
    // 名前・犬種・サイズは招待した側(アル)。性別は空でない方から。写真はママの写真
    expect(al).toEqual({ name: 'アル', breed_id: 1, size: 'small', sex: 'male', photo_key: mineKey, status: 'active' });
    const aruKun = await env.DB.prepare('SELECT status, merged_into_id FROM dogs WHERE id = ?').bind(mama.dogs[0]!.id).first();
    expect(aruKun).toEqual({ status: 'merged', merged_into_id: papa.dogs[0]!.id });
    // 来場した犬の記録も1頭分にまとまる
    const vd = await env.DB.prepare("SELECT dog_id FROM visit_dogs WHERE visit_date = '2026-10-02' ORDER BY dog_id").all();
    expect(vd.results.map((r) => r.dog_id)).toEqual([papa.dogs[0]!.id, mama.dogs[1]!.id]);
    // 写真の変更は、お客さんの操作として犬の変更履歴に残る
    const change = await env.DB.prepare("SELECT actor_type FROM dog_changes WHERE dog_id = ? AND field = 'photo'").bind(papa.dogs[0]!.id).first();
    expect(change).toEqual({ actor_type: 'member' });
  });

  it('写真を「招待した側」にしても、招待した側に写真がなければ、写真がある方を残す', async () => {
    const { papa, mama } = await seed();
    const mineKey = await setPhoto(MAMA, mama.dogs[0]!.id);
    const code = await invite();
    const res = await call(`/api/invites/${code}/merge`, {
      user: MAMA,
      now: NOW,
      body: { dogs: [{ dogId: mama.dogs[0]!.id, sameAs: papa.dogs[0]!.id, keepPhoto: 'theirs' }] },
    });
    expect(res.status).toBe(201);
    const al = await env.DB.prepare('SELECT photo_key FROM dogs WHERE id = ?').bind(papa.dogs[0]!.id).first();
    expect(al).toEqual({ photo_key: mineKey });
  });

  it('同じ子を選ばなければ、別の子として移る', async () => {
    const { papa, mama, keepId } = await seed();
    const code = await invite();
    const res = await call(`/api/invites/${code}/merge`, { user: MAMA, now: NOW, body: { dogs: [] } });
    expect(res.status).toBe(201);
    const { results } = await env.DB.prepare("SELECT id FROM dogs WHERE household_id = ? AND status = 'active' ORDER BY id").bind(keepId).all();
    expect(results.map((r) => r.id)).toEqual([papa.dogs[0]!.id, mama.dogs[0]!.id, mama.dogs[1]!.id]);
  });

  it('同時に2回押されても、まとめるのは1回だけ', async () => {
    const { papa, mama } = await seed();
    const code = await invite();
    const body = { dogs: [{ dogId: mama.dogs[0]!.id, sameAs: papa.dogs[0]!.id, keepPhoto: 'theirs' }] };
    const results = await Promise.all([1, 2].map(() => call(`/api/invites/${code}/merge`, { user: MAMA, now: NOW, body })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM merges').first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'household.merge'").first<{ n: number }>())!.n).toBe(1);
    expect((await me(MAMA)).body.household.memberNo).toBe(papa.memberNo);
    // 終わったあとにもう一度押しても、すでに同じおうち
    const late = await call(`/api/invites/${code}/merge`, { user: MAMA, now: NOW, body });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('already_member');
  });

  it('使われた招待・期限切れの招待・ない招待・まだ会員でない人では、まとめられない', async () => {
    const { papa, mama } = await seed();
    await registerUser(BAABA, [dog('ハナ')]);
    const code = await invite();
    // ばあば(別のおうち)が先にまとめると、同じ招待ではママはまとめられない
    expect((await call(`/api/invites/${code}/merge`, { user: BAABA, now: NOW, body: { dogs: [] } })).status).toBe(201);
    const used = await call(`/api/invites/${code}/merge`, { user: MAMA, now: NOW, body: { dogs: [] } });
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('invite_used');
    expect(used.body.error.message).toMatch(/もう一度招待を送ってもらって/);

    const code2 = await invite(PAPA, NOW);
    const expired = await call(`/api/invites/${code2}/merge`, { user: MAMA, now: '2026-10-29T03:00:01Z', body: { dogs: [] } });
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('invite_expired');

    expect((await call('/api/invites/nothing/merge', { user: MAMA, now: NOW, body: { dogs: [] } })).status).toBe(404);
    const stranger = await call(`/api/invites/${code2}/merge`, { user: 'U030:だれか', now: NOW, body: { dogs: [] } });
    expect(stranger.status).toBe(409);
    expect(stranger.body.error.code).toBe('not_registered');

    // 自分のワンちゃんでない犬・招待した側にいない犬は選べない
    const wrong = await call(`/api/invites/${code2}/merge`, {
      user: MAMA,
      now: NOW,
      body: { dogs: [{ dogId: papa.dogs[0]!.id, sameAs: mama.dogs[0]!.id }] },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toMatch(/選び直してください/);
    const twice = await call(`/api/invites/${code2}/merge`, {
      user: MAMA,
      now: NOW,
      body: {
        dogs: [
          { dogId: mama.dogs[0]!.id, sameAs: papa.dogs[0]!.id },
          { dogId: mama.dogs[1]!.id, sameAs: papa.dogs[0]!.id },
        ],
      },
    });
    expect(twice.status).toBe(400);
    expect((await me(MAMA)).body.household.memberNo).toBe(mama.memberNo);
  });

  it('招待したおうちが、すでにほかのおうちにまとめられている・退会しているときは、まとめられない', async () => {
    const { mama } = await seed();
    const code = await invite();
    await registerUser(BAABA, [dog('ハナ')]);
    const code3 = await invite(BAABA);
    // パパのおうちが、先にばあばのおうちにまとめられた
    expect((await call(`/api/invites/${code3}/merge`, { user: PAPA, now: NOW, body: { dogs: [] } })).status).toBe(201);
    const merged = await call(`/api/invites/${code}/merge`, { user: MAMA, now: NOW, body: { dogs: [] } });
    expect(merged.status).toBe(409);
    expect(merged.body.error).toMatchObject({
      code: 'already_merged',
      message: 'このおうちはすでにほかのおうちとまとめられています。受付にご相談ください。',
    });

    const code4 = await invite(BAABA);
    await env.DB.prepare("UPDATE households SET status = 'withdrawn' WHERE id = (SELECT household_id FROM invites WHERE code = ?)").bind(code4).run();
    const withdrawn = await call(`/api/invites/${code4}/merge`, { user: MAMA, now: NOW, body: { dogs: [] } });
    expect(withdrawn.status).toBe(409);
    expect(withdrawn.body.error.code).toBe('not_active');
    expect(withdrawn.body.error.message).toMatch(/受付にご相談ください/);
    expect((await me(MAMA)).body.household.memberNo).toBe(mama.memberNo);
  });

  it('「参加する」では、別のおうちがある人は参加できず、まとめる申請も作らない', async () => {
    await seed();
    const code = await invite();
    const res = await call(`/api/invites/${code}/accept`, { user: MAMA, now: NOW, body: { consent: true, survey: [] } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('use_merge');
    expect(res.body.error.message).toMatch(/「まとめる」から/);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM requests').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare('SELECT used_at FROM invites WHERE code = ?').bind(code).first())!.used_at).toBeNull();
  });

  it('受付で出した招待QRからも、同じようにまとめられる', async () => {
    const admin = await adminCookie();
    const { papa, keepId } = await seed();
    const qr = await adminCall(`/admin/api/households/${keepId}/invite-qr`, { cookie: admin, body: {}, now: NOW });
    expect(qr.status).toBe(201);
    const info = await call(`/api/invites/${qr.body.code}`, { user: MAMA, now: NOW });
    expect(info.body).toMatchObject({ viewer: 'other', inviterName: null, merge: { theirs: { memberNo: papa.memberNo } } });
    const res = await call(`/api/invites/${qr.body.code}/merge`, { user: MAMA, now: NOW, body: { dogs: [] } });
    expect(res.status).toBe(201);
    expect((await me(MAMA)).body.household.memberNo).toBe(papa.memberNo);
  });

  it('一緒に移った家族には、次に開いたとき「おうちが一つになりました」を1回だけ出す(まとめた本人には出さない)', async () => {
    const { papa, mama } = await seed();
    await addFamily(mama.memberNo, 'U003', 'ばあば');
    const code = await invite();
    await call(`/api/invites/${code}/merge`, { user: MAMA, now: NOW, body: { dogs: [] } });
    expect((await call('/api/merge-notice', { user: MAMA })).body).toEqual({ notice: null });
    expect((await call('/api/merge-notice', { user: PAPA })).body).toEqual({ notice: null });
    const notice = await call('/api/merge-notice', { user: BAABA });
    expect(notice.body.notice).toMatchObject({
      memberNo: papa.memberNo,
      householdName: 'アル・あるくん・モカのおうち',
      previousMemberNo: mama.memberNo,
      points: (await me(PAPA)).body.card.balance,
    });
    expect((await call('/api/merge-notice/seen', { user: BAABA, body: {} })).status).toBe(200);
    expect((await call('/api/merge-notice', { user: BAABA })).body).toEqual({ notice: null });
  });

  it('管理者は30日以内なら操作ログから元に戻せる。戻すと別々のおうちとポイントに戻り、お知らせも出なくなる', async () => {
    const admin = await adminCookie();
    const { papa, mama, absorbId } = await seed();
    await addFamily(mama.memberNo, 'U003', 'ばあば');
    const code = await invite();
    await call(`/api/invites/${code}/merge`, {
      user: MAMA,
      now: NOW,
      body: { dogs: [{ dogId: mama.dogs[0]!.id, sameAs: papa.dogs[0]!.id, keepPhoto: 'theirs' }] },
    });
    const log = await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'household.merge'").first<{ id: number }>();
    const undo = await adminCall(`/admin/api/audit/${log!.id}/undo`, { cookie: admin, body: {}, now: '2026-11-20T03:00:00Z' });
    expect(undo.status).toBe(200);
    const p = (await me(PAPA)).body;
    const m = (await me(MAMA)).body;
    expect(p.card.balance).toBe(7);
    expect(m.household.memberNo).toBe(mama.memberNo);
    expect(m.card.balance).toBe(5);
    expect(m.card.dogs.map((d: { name: string }) => d.name)).toEqual(['あるくん', 'モカ']);
    expect(await env.DB.prepare('SELECT status FROM households WHERE id = ?').bind(absorbId).first()).toEqual({ status: 'active' });
    expect((await call('/api/merge-notice', { user: BAABA })).body).toEqual({ notice: null });
    expect((await me(BAABA)).body.household.memberNo).toBe(mama.memberNo);
    const merge = await env.DB.prepare('SELECT undone_at, undone_by_staff_id, kept_household_id FROM merges').first();
    expect(merge).toMatchObject({ undone_at: '2026-11-20T12:00:00+09:00', undone_by_staff_id: 1 });
    expect(merge!.kept_household_id).toBe(await householdIdOf(papa.memberNo));
  });

  it('お客さんがまとめた後に来場があれば、管理者の統合と同じく元に戻せない(元に戻せるかの判定は同じ)', async () => {
    const admin = await adminCookie();
    const { papa } = await seed();
    const code = await invite();
    await call(`/api/invites/${code}/merge`, { user: MAMA, now: NOW, body: { dogs: [] } });
    await checkin(MAMA, [papa.dogs[0]!.id], { now: '2026-10-29T01:00:00Z' });
    const record = await adminCall('/admin/api/merges/1', { cookie: admin, now: '2026-10-29T03:00:00Z' });
    expect(record.body.undoStatus).toBe('changed');
    const log = await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'household.merge'").first<{ id: number }>();
    const undo = await adminCall(`/admin/api/audit/${log!.id}/undo`, { cookie: admin, body: {}, now: '2026-10-29T03:00:00Z' });
    expect(undo.status).toBe(409);
    expect(undo.body.error.message).toMatch(/製作者に依頼してください/);
  });
});
