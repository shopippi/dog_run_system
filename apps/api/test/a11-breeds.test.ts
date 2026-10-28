import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getUndo, type AuditRow } from '../src/services/undo';
import '../src/routes/admin/breeds';
import { adminCall, call, createStaff, dog, login, registerUser } from './helpers';

async function as(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
const lastLog = () => env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').first<AuditRow>();
const names = (breeds: { name: string }[]) => breeds.map((b) => b.name);
const customerBreeds = async () => names((await call('/api/breeds', { user: 'U009:だれか' })).body.breeds);

describe('A-11 犬種の選択肢の管理', () => {
  it('一覧は非表示を含み、「その他」が最後。登録されている犬の数も返す', async () => {
    const cookie = await as('admin');
    await registerUser('U001:パパ', [dog('アル'), dog('ニコ')]);
    const res = await adminCall('/admin/api/breeds', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.breeds.at(-1)).toMatchObject({ name: 'その他', isOther: true, visible: true });
    expect(res.body.breeds[0]).toMatchObject({ id: 1, name: 'トイプードル', defaultSize: 'small', dogCount: 2 });
  });

  it('追加すると「その他」の直前に入り、お客さんの選択肢にも出る。操作ログに残る', async () => {
    const cookie = await as('admin');
    const res = await adminCall('/admin/api/breeds', { cookie, body: { name: ' コーギー ', defaultSize: 'medium' } });
    expect(res.status).toBe(201);
    expect(names(res.body.breeds).slice(-2)).toEqual(['コーギー', 'その他']);
    expect((await customerBreeds()).slice(-2)).toEqual(['コーギー', 'その他']);
    expect(await lastLog()).toMatchObject({ action: 'breed.create', target_type: 'breed', target_id: String(res.body.id) });

    const dup = await adminCall('/admin/api/breeds', { cookie, body: { name: 'コーギー', defaultSize: 'small' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/もう選択肢にあります/);
    const empty = await adminCall('/admin/api/breeds', { cookie, body: { name: '  ', defaultSize: 'small' } });
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toBe('犬種の名前を入力してください。');
    expect((await adminCall('/admin/api/breeds', { cookie, body: { name: 'あ'.repeat(30), defaultSize: 'small' } })).status).toBe(201);
    expect((await adminCall('/admin/api/breeds', { cookie, body: { name: 'い'.repeat(31), defaultSize: 'small' } })).status).toBe(400);
  });

  it('非表示にすると、お客さんの選択肢から消えるが、登録済みの犬の犬種はそのまま表示される', async () => {
    const cookie = await as('admin');
    const r = await registerUser('U001:パパ', [dog('アル', { breedId: 5, size: 'medium' })]);
    const res = await adminCall('/admin/api/breeds/5', { cookie, method: 'PATCH', body: { visible: false } });
    expect(res.status).toBe(200);
    expect(res.body.breeds.find((b: { id: number }) => b.id === 5)).toMatchObject({ name: '柴犬', visible: false, dogCount: 1 });
    expect(await customerBreeds()).not.toContain('柴犬');

    const me = await call('/api/me', { user: 'U001:パパ' });
    expect(me.body.card.dogs[0]).toMatchObject({ name: 'アル', breedName: '柴犬' });
    const dogs = await call('/api/dogs', { user: 'U001:パパ' });
    expect(dogs.body.dogs[0]).toMatchObject({ breedName: '柴犬' });
    const staff = await adminCall(`/admin/api/households?q=${encodeURIComponent(r.memberNo)}`, { cookie });
    expect(staff.body.households[0].dogs[0]).toMatchObject({ breedName: '柴犬' });

    // 表示に戻せる
    await adminCall('/admin/api/breeds/5', { cookie, method: 'PATCH', body: { visible: true } });
    expect(await customerBreeds()).toContain('柴犬');
  });

  it('「その他」は非表示にできない', async () => {
    const cookie = await as('admin');
    const res = await adminCall('/admin/api/breeds/11', { cookie, method: 'PATCH', body: { visible: false } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/「その他」/);
  });

  it('名前とサイズを変えられる。登録済みの犬のサイズは変わらない。操作ログから元に戻せる', async () => {
    const cookie = await as('admin');
    await registerUser('U001:パパ', [dog('アル')]);
    const res = await adminCall('/admin/api/breeds/1', { cookie, method: 'PATCH', body: { name: 'トイ・プードル', defaultSize: 'medium' } });
    expect(res.status).toBe(200);
    expect(res.body.breeds[0]).toMatchObject({ name: 'トイ・プードル', defaultSize: 'medium' });
    const me = await call('/api/me', { user: 'U001:パパ' });
    expect(me.body.card.dogs[0]).toMatchObject({ breedName: 'トイ・プードル', size: 'small' });

    const log = (await lastLog())!;
    expect(JSON.parse(log.before_value!)).toEqual({ name: 'トイプードル', defaultSize: 'small' });
    await getUndo('breed.update')!(env.DB, log, { staffId: 1, now: new Date() });
    const back = await adminCall('/admin/api/breeds', { cookie });
    expect(back.body.breeds[0]).toMatchObject({ name: 'トイプードル', defaultSize: 'small' });

    // 同じ名前にはできない
    const dup = await adminCall('/admin/api/breeds/1', { cookie, method: 'PATCH', body: { name: 'チワワ' } });
    expect(dup.status).toBe(409);
  });

  it('並べ替えると、お客さんの選択肢もその順になり、「その他」は最後のまま。元に戻せる', async () => {
    const cookie = await as('admin');
    const list = (await adminCall('/admin/api/breeds', { cookie })).body.breeds as { id: number; isOther: boolean }[];
    const ids = list.filter((b) => !b.isOther).map((b) => b.id);
    const reversed = [...ids].reverse();
    const res = await adminCall('/admin/api/breeds/order', { cookie, body: { ids: reversed } });
    expect(res.status).toBe(200);
    expect(res.body.breeds.map((b: { id: number }) => b.id)).toEqual([...reversed, 11]);
    const cust = await customerBreeds();
    expect(cust[0]).toBe('ミックス');
    expect(cust.at(-1)).toBe('その他');
    expect(await lastLog()).toMatchObject({ action: 'breed.reorder' });

    // 足りない・知らない番号は受け付けない
    expect((await adminCall('/admin/api/breeds/order', { cookie, body: { ids: ids.slice(1) } })).status).toBe(409);
    expect((await adminCall('/admin/api/breeds/order', { cookie, body: { ids: [...ids.slice(1), 11] } })).status).toBe(409);

    await getUndo('breed.reorder')!(env.DB, (await lastLog())!, { staffId: 1, now: new Date() });
    const back = await adminCall('/admin/api/breeds', { cookie });
    expect(back.body.breeds.map((b: { id: number }) => b.id)).toEqual([...ids, 11]);
  });

  it('受付スタッフは 403。製作者は見られるが、変更は 403', async () => {
    const staff = await as('staff');
    expect((await adminCall('/admin/api/breeds', { cookie: staff })).status).toBe(403);
    expect((await adminCall('/admin/api/breeds', { cookie: staff, body: { name: 'コーギー', defaultSize: 'medium' } })).status).toBe(403);
    const dev = await as('developer');
    expect((await adminCall('/admin/api/breeds', { cookie: dev })).status).toBe(200);
    expect((await adminCall('/admin/api/breeds', { cookie: dev, body: { name: 'コーギー', defaultSize: 'medium' } })).status).toBe(403);
    expect((await adminCall('/admin/api/breeds/1', { cookie: dev, method: 'PATCH', body: { visible: false } })).status).toBe(403);
    expect((await adminCall('/admin/api/breeds/order', { cookie: dev, body: { ids: [] } })).status).toBe(403);
  });
});
