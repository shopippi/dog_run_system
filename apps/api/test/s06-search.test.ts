import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, adminCall, checkin, createStaff, dog, login, registerUser } from './helpers';

async function cookies() {
  await createStaff('staff@example.com', 'staff');
  await createStaff('admin@example.com', 'admin');
  return { staff: await login('staff@example.com'), admin: await login('admin@example.com') };
}
const search = (cookie: string, q: string) =>
  adminCall(`/admin/api/households?q=${encodeURIComponent(q)}`, { cookie }).then((r) => r.body.households as any[]);

describe('S-06 おうちの検索', () => {
  it('犬の名前で探せる。ひらがなとカタカナは区別しない', async () => {
    const { staff } = await cookies();
    const r = await registerUser('U001:パパ', [dog('アル'), dog('ニコ')]);
    await registerUser('U002:よそ', [dog('ハナ')]);
    for (const q of ['にこ', 'ニコ', 'ﾆｺ']) {
      const hits = await search(staff, q);
      expect(hits.map((h) => h.memberNo)).toEqual([r.memberNo]);
    }
    const [hit] = await search(staff, 'にこ');
    expect(hit).toMatchObject({ displayName: 'アル・ニコのおうち', status: 'active', mergedIntoMemberNo: null });
    expect(hit.dogs.map((d: { name: string }) => d.name)).toEqual(['アル', 'ニコ']);
  });

  it('おうちの呼び名と会員IDでも探せる', async () => {
    const { staff } = await cookies();
    const r = await registerUser('U001:パパ', [dog('アル')]);
    await env.DB.prepare("UPDATE households SET display_name = 'アルくんち', display_name_search = 'あるくんち'").run();
    expect((await search(staff, 'くんち')).map((h) => h.memberNo)).toEqual([r.memberNo]);
    expect((await search(staff, r.memberNo.toLowerCase())).map((h) => h.memberNo)).toEqual([r.memberNo]);
    expect((await search(staff, '000001')).map((h) => h.memberNo)).toEqual([r.memberNo]);
  });

  it('家族の LINE の表示名でも探せる(受付スタッフも管理者も)', async () => {
    const { staff, admin } = await cookies();
    const r = await registerUser('U001:山田パパ', [dog('アル')]);
    await addFamily(r.memberNo, 'U002', '山田ママ');
    for (const cookie of [staff, admin]) {
      const hits = await search(cookie, '山田');
      expect(hits).toHaveLength(1);
      expect(hits[0].familyNames).toEqual(['山田パパ', '山田ママ']);
    }
  });

  it('統合済みの会員IDを探すと、統合先を返す', async () => {
    const { staff } = await cookies();
    const a = await registerUser('U001:パパ', [dog('アル')]);
    const b = await registerUser('U002:ママ', [dog('アル')]);
    await env.DB.prepare(
      "UPDATE households SET status = 'merged', merged_into_id = (SELECT id FROM households WHERE member_no = ?) WHERE member_no = ?",
    )
      .bind(a.memberNo, b.memberNo)
      .run();
    const [hit] = await search(staff, b.memberNo);
    expect(hit).toMatchObject({ memberNo: b.memberNo, status: 'merged', mergedIntoMemberNo: a.memberNo });
  });

  it('最近来たおうちが先に出る', async () => {
    const { staff } = await cookies();
    const a = await registerUser('U001:パパ', [dog('ココ')]);
    const b = await registerUser('U002:ママ', [dog('ココア')]);
    await checkin('U001:パパ', [a.dogs[0]!.id], { now: '2026-10-20T01:00:00Z' });
    await checkin('U002:ママ', [b.dogs[0]!.id], { now: '2026-10-27T01:00:00Z' });
    const hits = await search(staff, 'ここ');
    expect(hits.map((h) => h.memberNo)).toEqual([b.memberNo, a.memberNo]);
    expect(hits[0].lastVisit).toBe('2026-10-27');
  });

  it('% や _ はそのままの文字として探す', async () => {
    const { staff } = await cookies();
    await registerUser('U001:パパ', [dog('アル')]);
    expect(await search(staff, '%')).toEqual([]);
    expect(await search(staff, '_')).toEqual([]);
  });

  it('何も入れないと、最近来たおうち(写真で探す)を返す', async () => {
    const { staff } = await cookies();
    const a = await registerUser('U001:パパ', [dog('アル')]);
    await registerUser('U002:ママ', [dog('ハナ')]); // まだ来ていない
    await checkin('U001:パパ', [a.dogs[0]!.id], { now: '2026-10-27T01:00:00Z' });
    const res = await adminCall('/admin/api/households', { cookie: staff });
    expect(res.body.households.map((h: { memberNo: string }) => h.memberNo)).toEqual([a.memberNo]);
  });

  it('ログインしていないと探せない', async () => {
    expect((await adminCall('/admin/api/households?q=a')).status).toBe(401);
  });
});
