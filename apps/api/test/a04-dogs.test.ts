import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE, adminCall, call, checkin, createStaff, dog, fakeJpeg, login, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const DAY1 = '2026-10-28T01:00:00Z';

async function setup(dogs = [dog('アル'), dog('ニコ')]) {
  await createStaff('staff@example.com', 'staff');
  await createStaff('admin@example.com', 'admin');
  await createStaff('dev@example.com', 'developer');
  const r = await registerUser(PAPA, dogs);
  return {
    r,
    staff: await login('staff@example.com'),
    admin: await login('admin@example.com'),
    dev: await login('dev@example.com'),
  };
}
const patch = (cookie: string, id: number, body: Record<string, unknown>) =>
  adminCall(`/admin/api/dogs/${id}`, { cookie, method: 'PATCH', body, now: DAY1 });

async function uploadPhoto(cookie: string, id: number, kind?: 'replace' | 'rotate', size: [number, number] = [800, 600]) {
  const form = new FormData();
  form.append('photo', new File([fakeJpeg(size[0], size[1])], 'photo.jpg', { type: 'image/jpeg' }));
  form.append('thumb', new File([fakeJpeg(240, 240)], 'thumb.jpg', { type: 'image/jpeg' }));
  if (kind) form.append('kind', kind);
  const res = await SELF.fetch(`${BASE}/admin/api/dogs/${id}/photo`, {
    method: 'POST',
    headers: { cookie, 'x-dr-admin': '1', 'x-debug-now': DAY1 },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as any };
}
const lastLog = async (action: string) =>
  (await env.DB.prepare('SELECT id FROM audit_log WHERE action = ? ORDER BY id DESC').bind(action).first<{ id: number }>())!.id;
const undo = (cookie: string, id: number) => adminCall(`/admin/api/audit/${id}/undo`, { cookie, body: {}, now: DAY1 });

describe('A-04 犬の情報の変更', () => {
  it('19.2: 管理者が犬の写真・名前を変えると、会員証と今日の来場にすぐ反映される。犬種の変更は履歴に残る', async () => {
    const s = await setup();
    const alu = s.r.dogs[0]!.id;
    await checkin(PAPA, [alu], { now: DAY1 });

    expect((await patch(s.admin, alu, { name: 'アルル' })).status).toBe(200);
    const up = await uploadPhoto(s.admin, alu);
    expect(up.status).toBe(200);
    expect(up.body.dog.photoUrl).toMatch(/^\/admin\/api\/media\/dogs\//);

    const me = await call('/api/me', { user: PAPA, now: DAY1 });
    const cardDog = me.body.card.dogs.find((d: any) => d.id === alu);
    expect(cardDog.name).toBe('アルル');
    expect(cardDog.photoUrl).toMatch(/^\/api\/media\/dogs\/.+\.jpg$/);
    // お客さんの画面から、新しい写真を開ける
    const img = await SELF.fetch(`${BASE}${cardDog.photoUrl}`, { headers: { authorization: 'Bearer mock:U001:%E3%83%91%E3%83%91' } });
    expect(img.status).toBe(200);
    expect(me.body.household.displayName).toBe('アルル・ニコのおうち');

    const today = await adminCall('/admin/api/today', { cookie: s.staff, now: DAY1 });
    expect(today.body.visits[0].dogs[0]).toMatchObject({ name: 'アルル', thumbUrl: expect.stringMatching(/_thumb\.jpg$/) });
    expect(today.body.visits[0].householdName).toBe('アルル・ニコのおうち');

    // 犬種の変更は、理由つきで履歴に残る
    const res = await patch(s.admin, alu, { breedId: 5, size: 'medium', reason: '登録のまちがい' });
    expect(res.status).toBe(200);
    expect(res.body.dog).toMatchObject({ breedName: '柴犬', size: 'medium' });
    expect(res.body.changes.slice(0, 2)).toEqual([
      expect.objectContaining({ fieldLabel: 'サイズ', before: '小型', after: '中型', reason: '登録のまちがい', actorName: '管理者' }),
      expect.objectContaining({ fieldLabel: '犬種', before: 'プードル', after: '柴犬', reason: '登録のまちがい' }),
    ]);
    const row = await env.DB.prepare("SELECT before_value, after_value, reason, actor_type FROM dog_changes WHERE field = 'breed'").first();
    expect(row).toEqual({ before_value: 'プードル', after_value: '柴犬', reason: '登録のまちがい', actor_type: 'staff' });

    const log = await adminCall('/admin/api/audit?action=dog.update', { cookie: s.admin });
    expect(log.body.entries.map((e: any) => e.detail)).toEqual([
      '犬種: プードル → 柴犬、サイズ: 小型 → 中型',
      '名前: アル → アルル',
    ]);
    expect(log.body.entries[0].target).toMatchObject({ label: 'アルル(アルル・ニコのおうち)', code: `${s.r.memberNo}-1` });
  });

  it('犬種・サイズを変えるときは理由が要る(400)。「その他」は犬種の入力が要る', async () => {
    const s = await setup();
    const id = s.r.dogs[0]!.id;
    const noReason = await patch(s.admin, id, { breedId: 5 });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.message).toMatch(/変える理由を入力してください/);
    expect((await patch(s.admin, id, { size: 'large' })).status).toBe(400);
    const other = await patch(s.admin, id, { breedId: 11, reason: '雑種と分かった' });
    expect(other.status).toBe(400);
    const ok = await patch(s.admin, id, { breedId: 11, breedOther: 'ビーグルミックス', reason: '雑種と分かった' });
    expect(ok.body.dog).toMatchObject({ breedName: 'ビーグルミックス', breedOther: 'ビーグルミックス' });
  });

  it('性別・生まれた年月・登録のおやすみと登録に戻す操作。最後の1頭はおやすみできない', async () => {
    const s = await setup();
    const [a, n] = [s.r.dogs[0]!.id, s.r.dogs[1]!.id];
    const res = await patch(s.admin, a, { sex: 'male', birthYm: '2019-05' });
    expect(res.body.dog).toMatchObject({ sex: 'male', birthYm: '2019-05' });
    expect((await patch(s.admin, a, { status: 'retired' })).body.dog.status).toBe('retired');
    const me = await call('/api/me', { user: PAPA, now: DAY1 });
    expect(me.body.card.dogs.map((d: any) => d.name)).toEqual(['ニコ']);
    const last = await patch(s.admin, n, { status: 'retired' });
    expect(last.status).toBe(409);
    expect(last.body.error.message).toMatch(/最後の1頭は、登録をおやすみできません/);
    expect((await patch(s.admin, a, { status: 'active' })).body.dog.status).toBe('active');
  });

  it('変更は操作ログから元に戻せる。その後にまた同じ項目を変えていたら戻せない', async () => {
    const s = await setup();
    const id = s.r.dogs[0]!.id;
    await patch(s.admin, id, { name: 'アルル', breedId: 5, size: 'medium', reason: 'まちがい' });
    expect((await undo(s.admin, await lastLog('dog.update'))).status).toBe(200);
    const back = await adminCall(`/admin/api/dogs/${id}`, { cookie: s.admin });
    expect(back.body.dog).toMatchObject({ name: 'アル', breedName: 'プードル', size: 'small' });
    expect(back.body.changes[0]).toMatchObject({ reason: '操作ログから元に戻した' });
    expect(back.body.household.displayName).toBe('アル・ニコのおうち');

    await patch(s.admin, id, { name: 'A' });
    const first = await lastLog('dog.update');
    await patch(s.admin, id, { name: 'B' });
    const res = await undo(s.admin, first);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/また変えられているため/);
  });

  it('写真の差し替え・回転・削除は、操作ログから前の写真に戻せる。削除しても保存先の写真は残す', async () => {
    const s = await setup();
    const id = s.r.dogs[0]!.id;
    const first = await uploadPhoto(s.admin, id);
    const firstKey = first.body.dog.photoUrl.replace('/admin/api/media/', '');
    const rotated = await uploadPhoto(s.admin, id, 'rotate', [600, 800]);
    expect(rotated.body.dog.photoUrl).not.toBe(first.body.dog.photoUrl);

    const log = await adminCall('/admin/api/audit', { cookie: s.admin });
    expect(log.body.entries.map((e: any) => e.actionLabel).slice(0, 2)).toEqual(['ワンちゃんの写真の回転', 'ワンちゃんの写真の差し替え']);

    expect((await undo(s.admin, await lastLog('dog.photo_rotate'))).status).toBe(200);
    let d = await adminCall(`/admin/api/dogs/${id}`, { cookie: s.admin });
    expect(d.body.dog.photoUrl).toBe(first.body.dog.photoUrl);

    const del = await adminCall(`/admin/api/dogs/${id}/photo`, { cookie: s.admin, method: 'DELETE', now: DAY1 });
    expect(del.status).toBe(200);
    expect(del.body.dog).toMatchObject({ photoUrl: null, thumbUrl: null });
    expect(await env.MEDIA.head(firstKey)).not.toBeNull();
    expect((await adminCall(`/admin/api/dogs/${id}/photo`, { cookie: s.admin, method: 'DELETE', now: DAY1 })).status).toBe(409);

    expect((await undo(s.admin, await lastLog('dog.photo_remove'))).status).toBe(200);
    d = await adminCall(`/admin/api/dogs/${id}`, { cookie: s.admin });
    expect(d.body.dog.photoUrl).toBe(first.body.dog.photoUrl);

    // 最初の差し替えは、そのあとに写真が変わっていないので戻せる(写真なしに戻る)
    expect((await undo(s.admin, await lastLog('dog.photo'))).status).toBe(200);
    d = await adminCall(`/admin/api/dogs/${id}`, { cookie: s.admin });
    expect(d.body.dog.photoUrl).toBeNull();
  });

  it('大きすぎる写真は 400。受付スタッフは見られず(403)、製作者は見るだけ', async () => {
    const s = await setup();
    const id = s.r.dogs[0]!.id;
    expect((await uploadPhoto(s.admin, id, 'replace', [1600, 1200])).status).toBe(400);
    expect((await adminCall(`/admin/api/dogs/${id}`, { cookie: s.staff })).status).toBe(403);
    expect((await patch(s.staff, id, { name: 'X' })).status).toBe(403);
    expect((await uploadPhoto(s.staff, id)).status).toBe(403);
    const dev = await adminCall(`/admin/api/dogs/${id}`, { cookie: s.dev });
    expect(dev.status).toBe(200);
    expect(dev.body.breeds.length).toBeGreaterThan(5);
    expect((await patch(s.dev, id, { name: 'X' })).status).toBe(403);
    expect((await uploadPhoto(s.dev, id)).status).toBe(403);
    expect((await adminCall('/admin/api/dogs/999', { cookie: s.admin })).status).toBe(404);
  });

  it('統合でまとめられた犬は変えられない(409)', async () => {
    const s = await setup();
    const id = s.r.dogs[1]!.id;
    await env.DB.prepare("UPDATE dogs SET status = 'merged' WHERE id = ?").bind(id).run();
    const res = await patch(s.admin, id, { name: 'X' });
    expect(res.status).toBe(409);
  });
});
