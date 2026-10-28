import { env } from 'cloudflare:test';
import { BREED_GROUP_ALIASES, INITIAL_BREEDS } from '@dr/shared';
import { describe, expect, it } from 'vitest';
import '../src/routes/admin/breeds';
import { adminCall, call, createStaff, dog, login, registerUser } from './helpers';

// A-11 犬種を大まかな分け方にする(docs/changes-2026-10-28.md 6章、migrations/0007_profile.sql)

const customerBreeds = async () => (await call('/api/breeds', { user: 'U009:だれか' })).body.breeds as { id: number; name: string }[];

/** 0007_profile.sql のうち、犬種をまとめる文(breeds を読む・書く文)だけを流し直す */
async function runBreedConsolidation() {
  const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith('0007_'))!;
  for (const q of m.queries.filter((x) => /breeds/.test(x))) await env.DB.prepare(q).run();
}

/** 以前の初期の犬種(11件)のデータベースに戻す(テストの準備。すでに運用しているデータベースのつもり) */
async function toOldBreeds() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM breeds WHERE id >= 12'),
    env.DB.prepare("UPDATE breeds SET name = 'トイプードル' WHERE id = 1"),
    env.DB.prepare("UPDATE breeds SET name = 'ミニチュアダックスフンド' WHERE id = 3"),
    env.DB.prepare('UPDATE breeds SET sort_order = id * 10 WHERE is_other = 0'),
    // 管理者が足していた細かい犬種と、細かくない犬種
    env.DB.prepare("INSERT INTO breeds (id, name, default_size, sort_order) VALUES (12, 'カニンヘンダックスフンド', 'small', 110)"),
    env.DB.prepare("INSERT INTO breeds (id, name, default_size, sort_order) VALUES (13, 'ロングコートチワワ', 'small', 120)"),
    env.DB.prepare("INSERT INTO breeds (id, name, default_size, sort_order) VALUES (14, '甲斐犬', 'medium', 130)"),
  ]);
}

describe('A-11 犬種を大まかな分け方にする', () => {
  it('新しいデータベースの選択肢は、大まかな分け方の26件で、日本で多い順。「ミックス」「その他」が最後', async () => {
    const breeds = await customerBreeds();
    expect(breeds.map((b) => b.name)).toEqual(INITIAL_BREEDS.map((b) => b.name));
    expect(breeds.map((b) => b.id)).toEqual(INITIAL_BREEDS.map((b) => b.id));
    expect(breeds).toHaveLength(26);
    expect(breeds.slice(0, 3).map((b) => b.name)).toEqual(['プードル', 'チワワ', 'ダックスフンド']);
    expect(breeds.slice(-2).map((b) => b.name)).toEqual(['ミックス', 'その他']);
    // 以前の初期の番号を保つ(1 プードル、5 柴犬、10 ミックス、11 その他)
    expect(breeds.find((b) => b.id === 5)?.name).toBe('柴犬');
    expect(breeds.find((b) => b.id === 11)?.name).toBe('その他');
    const { results } = await env.DB.prepare('SELECT id, name, default_size, is_other FROM breeds ORDER BY id').all();
    expect(results).toEqual(
      [...INITIAL_BREEDS].sort((a, b) => a.id - b.id).map((b) => ({ id: b.id, name: b.name, default_size: b.defaultSize, is_other: b.isOther ? 1 : 0 })),
    );
    // 新しいデータベースでは、まとめる犬種がないので記録もない
    const log = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'breed.consolidate'").first<{ n: number }>();
    expect(log?.n).toBe(0);
  });

  it('すでにあるデータベースでは、細かい犬種を大まかな犬種にまとめる。犬は付け替えて履歴に残し、古い犬種は非表示で残す', async () => {
    await toOldBreeds();
    const r = await registerUser('U001:パパ', [
      dog('アル'), // トイプードル(1)
      dog('ダック', { breedId: 12 }), // カニンヘンダックスフンド
      dog('チワ', { breedId: 13 }), // ロングコートチワワ
      dog('カイ', { breedId: 14, size: 'medium' }), // 甲斐犬(管理者が足した、まとめない犬種)
    ]);
    const before = await call('/api/me', { user: 'U001:パパ' });
    expect(before.body.card.dogs.map((d: { breedName: string }) => d.breedName)).toEqual([
      'トイプードル',
      'カニンヘンダックスフンド',
      'ロングコートチワワ',
      '甲斐犬',
    ]);

    await runBreedConsolidation();

    const me = await call('/api/me', { user: 'U001:パパ' });
    expect(me.body.card.dogs.map((d: { breedName: string }) => d.breedName)).toEqual(['プードル', 'ダックスフンド', 'チワワ', '甲斐犬']);
    const ids = await env.DB.prepare('SELECT name, breed_id FROM dogs ORDER BY id').all();
    expect(ids.results).toEqual([
      { name: 'アル', breed_id: 1 },
      { name: 'ダック', breed_id: 3 },
      { name: 'チワ', breed_id: 2 },
      { name: 'カイ', breed_id: 14 },
    ]);

    // お客さんの選択肢は新しい一覧の順。管理者が足した犬種は「ミックス」の前に残る
    const names = (await customerBreeds()).map((b) => b.name);
    const expected = INITIAL_BREEDS.map((b) => b.name).filter((n) => n !== 'ミックス' && n !== 'その他');
    expect(names).toEqual([...expected, '甲斐犬', 'ミックス', 'その他']);

    // 古い細かい犬種は削除せず、非表示にする(管理画面の一覧には残り、名前の変更・並べ替え・表示に戻すことができる)
    const admin = await (async () => {
      await createStaff('admin@example.com', 'admin');
      return login('admin@example.com');
    })();
    const list = await adminCall('/admin/api/breeds', { cookie: admin });
    expect(list.body.breeds.filter((b: { visible: boolean }) => !b.visible).map((b: { name: string }) => b.name).sort()).toEqual(
      ['カニンヘンダックスフンド', 'ロングコートチワワ'].sort(),
    );
    expect(list.body.breeds.find((b: { name: string }) => b.name === 'ダックスフンド')).toMatchObject({ id: 3, dogCount: 1 });

    // 犬の変更履歴と操作ログに残る
    const { results: changes } = await env.DB.prepare(
      "SELECT dog_id, before_value, after_value, actor_type FROM dog_changes WHERE field = 'breed' ORDER BY dog_id",
    ).all();
    expect(changes).toEqual([
      { dog_id: r.dogs[1]!.id, before_value: 'カニンヘンダックスフンド', after_value: 'ダックスフンド', actor_type: 'system' },
      { dog_id: r.dogs[2]!.id, before_value: 'ロングコートチワワ', after_value: 'チワワ', actor_type: 'system' },
    ]);
    const audit = await adminCall('/admin/api/audit', { cookie: admin });
    const entry = audit.body.entries.find((e: { actionLabel: string }) => e.actionLabel === '犬種を大まかな分け方にまとめた');
    expect(entry).toBeTruthy();
    expect(entry.detail).toContain('カニンヘンダックスフンド(1頭)');
    expect(entry.detail).toContain('トイプードル(1頭)');

    // もう一度流しても、何も変わらない
    await runBreedConsolidation();
    const again = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'breed.consolidate'").first<{ n: number }>();
    expect(again?.n).toBe(1);
    const changes2 = await env.DB.prepare("SELECT COUNT(*) AS n FROM dog_changes WHERE field = 'breed'").first<{ n: number }>();
    expect(changes2?.n).toBe(2);
  });

  it('同じ名前の犬種がすでにあるときは、名前を変えずに付け替えてまとめる', async () => {
    await toOldBreeds();
    // 管理者が「プードル」をすでに足していた
    await env.DB.prepare("INSERT INTO breeds (id, name, default_size, sort_order) VALUES (20, 'プードル', 'small', 140)").run();
    await registerUser('U001:パパ', [dog('アル')]);
    await runBreedConsolidation();
    const d = await env.DB.prepare('SELECT b.name, b.id FROM dogs JOIN breeds b ON b.id = dogs.breed_id').first();
    expect(d).toEqual({ name: 'プードル', id: 20 });
    const old = await env.DB.prepare('SELECT name, visible FROM breeds WHERE id = 1').first();
    expect(old).toEqual({ name: 'トイプードル', visible: 0 });
    expect((await customerBreeds()).map((b) => b.name)).toEqual(INITIAL_BREEDS.map((b) => b.name).slice(0, 24).concat(['甲斐犬', 'ミックス', 'その他']));
  });

  it('細かい犬種名と大まかな犬種名の対応は、マイグレーションと packages/shared で同じ', () => {
    const sql = env.TEST_MIGRATIONS.find((x) => x.name.startsWith('0007_'))!.queries.join('\n');
    const names = new Set(INITIAL_BREEDS.map((b) => b.name));
    for (const [old, group] of Object.entries(BREED_GROUP_ALIASES)) {
      expect(names.has(group), group).toBe(true);
      expect(sql).toContain(`('${old}', '${group}')`);
    }
    const cte = env.TEST_MIGRATIONS.find((x) => x.name.startsWith('0007_'))!.queries.filter((q) => q.includes('WITH m(old, new)')).join('\n');
    const pairs = cte.match(/\('[^']+', '[^']+'\)/g) ?? [];
    const inSql = new Set(pairs);
    expect(inSql.size).toBe(Object.keys(BREED_GROUP_ALIASES).length);
  });
});
