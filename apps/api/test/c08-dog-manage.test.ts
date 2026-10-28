import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, dog, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const OTHER = 'U900:よその人';

describe('C-08 犬の管理', () => {
  it('自分のおうちの犬の一覧を返す', async () => {
    await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const res = await call('/api/dogs', { user: PAPA });
    expect(res.status).toBe(200);
    expect(res.body.dogs.map((d: { name: string }) => d.name)).toEqual(['アル', 'ニコ']);
  });

  it('犬を追加すると、犬IDは続きの番号になり、おうちの呼び名に加わる', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const res = await call('/api/dogs', { user: PAPA, body: dog('モモ', { breedId: 2 }) });
    expect(res.status).toBe(201);
    expect(res.body.dog).toMatchObject({ dogNo: `${r.memberNo}-3`, name: 'モモ', breedName: 'チワワ' });
    const me = await call('/api/me', { user: PAPA });
    expect(me.body.household.displayName).toBe('アル・ニコ・モモのおうち');
  });

  it('名前・性別・生まれた年月・避妊去勢を変えられ、変更履歴が残る', async () => {
    const r = await registerUser(PAPA);
    const id = r.dogs[0]!.id;
    const res = await call(`/api/dogs/${id}`, {
      user: PAPA,
      method: 'PATCH',
      body: { name: 'アルくん', sex: 'male', birthYm: '2021-05' },
    });
    expect(res.status).toBe(200);
    expect(res.body.dog).toMatchObject({ name: 'アルくん', sex: 'male', birthYm: '2021-05' });

    const { results } = await env.DB.prepare('SELECT field, before_value, after_value FROM dog_changes ORDER BY id').all();
    expect(results).toEqual([
      { field: 'name', before_value: 'アル', after_value: 'アルくん' },
      { field: 'sex', before_value: null, after_value: 'male' },
      { field: 'birth_ym', before_value: null, after_value: '2021-05' },
    ]);
    const me = await call('/api/me', { user: PAPA });
    expect(me.body.household.displayName).toBe('アルくんのおうち');
  });

  it('犬種とサイズはお客さんには変えられない(送っても無視する)', async () => {
    const r = await registerUser(PAPA);
    const res = await call(`/api/dogs/${r.dogs[0]!.id}`, {
      user: PAPA,
      method: 'PATCH',
      body: { breedId: 5, size: 'large' },
    });
    expect(res.status).toBe(200);
    expect(res.body.dog).toMatchObject({ breedName: 'トイプードル', size: 'small' });
  });

  it('管理者が呼び名を変えたおうちは、犬の名前を変えても呼び名は変わらない', async () => {
    const r = await registerUser(PAPA);
    await env.DB.prepare("UPDATE households SET display_name = 'アルくんち', display_name_auto = 0").run();
    await call(`/api/dogs/${r.dogs[0]!.id}`, { user: PAPA, method: 'PATCH', body: { name: 'アルル' } });
    const me = await call('/api/me', { user: PAPA });
    expect(me.body.household.displayName).toBe('アルくんち');
  });

  it('登録解除すると一覧に「登録解除」として残り、呼び名から外れる', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const res = await call(`/api/dogs/${r.dogs[1]!.id}/retire`, { user: PAPA, method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.body.dog.status).toBe('retired');
    const list = await call('/api/dogs', { user: PAPA });
    expect(list.body.dogs.map((d: { status: string }) => d.status)).toEqual(['active', 'retired']);
    const me = await call('/api/me', { user: PAPA });
    expect(me.body.household.displayName).toBe('アルのおうち');
  });

  it('最後の1頭は登録解除できない', async () => {
    const r = await registerUser(PAPA);
    const res = await call(`/api/dogs/${r.dogs[0]!.id}/retire`, { user: PAPA, method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/追加してから/);
  });

  it('よそのおうちの犬は変更も登録解除もできない', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    await registerUser(OTHER, [dog('ハナ')]);
    const id = r.dogs[0]!.id;
    expect((await call(`/api/dogs/${id}`, { user: OTHER, method: 'PATCH', body: { name: 'x' } })).status).toBe(404);
    expect((await call(`/api/dogs/${id}/retire`, { user: OTHER, method: 'POST' })).status).toBe(404);
  });

  it('検索用の名前もそろえて更新する', async () => {
    const r = await registerUser(PAPA);
    await call(`/api/dogs/${r.dogs[0]!.id}`, { user: PAPA, method: 'PATCH', body: { name: 'マロン' } });
    const d = await env.DB.prepare('SELECT name_search FROM dogs').first();
    expect(d).toEqual({ name_search: 'まろん' });
    const h = await env.DB.prepare('SELECT display_name_search FROM households').first();
    expect(h).toEqual({ display_name_search: 'まろんのおうち' });
  });
});
