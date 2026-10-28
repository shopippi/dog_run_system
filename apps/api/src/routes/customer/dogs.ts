import { dogInputSchema, dogPatchSchema, normalizeForSearch, toJstIso } from '@dr/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { parseJson } from '../../lib/validate';
import {
  dogChangeStatement,
  getDog,
  getDogHouseholdId,
  insertDogStatements,
  listBreeds,
  listHouseholdDogs,
  nextDogSeq,
  normalizeDogInputs,
  refreshAutoNameStatement,
  saveDogPhoto,
  syncHouseholdSearchName,
} from '../../services/dogs';
import { requireMember } from '../../services/members';
import { MEDIA_BASE } from './media';

export const dogRoutes = new Hono<AppEnv>();

// 犬種の選択肢(C-02)
dogRoutes.get('/breeds', async (c) => c.json({ breeds: await listBreeds(c.env.DB) }));

/** 自分のおうちの犬でなければ「見つからない」にする(ほかのおうちの犬があるかどうかも分からないようにする) */
async function requireOwnDog(c: Context<AppEnv>, id: number) {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const householdId = Number.isInteger(id) ? await getDogHouseholdId(c.env.DB, id) : null;
  if (householdId !== member.householdId) {
    throw errors.notFound('ワンちゃんが見つかりませんでした。画面を読み込み直してください。');
  }
  return member;
}

// 犬の一覧(C-08)。登録解除した犬も、過去の記録として返す
dogRoutes.get('/dogs', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  return c.json({ dogs: await listHouseholdDogs(c.env.DB, member.householdId, MEDIA_BASE, true) });
});

// 犬の追加(C-08)
dogRoutes.post('/dogs', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const input = await parseJson(c, dogInputSchema);
  const [dog] = await normalizeDogInputs(c.env.DB, [input]);
  const nowIso = toJstIso(c.get('now'));
  const seq = await nextDogSeq(c.env.DB, member.memberNo);
  const [insert] = insertDogStatements(c.env.DB, member.householdId, member.memberNo, seq, [dog!], nowIso);
  const results = await c.env.DB.batch([
    insert!,
    refreshAutoNameStatement(c.env.DB, member.householdId, nowIso),
  ]);
  await syncHouseholdSearchName(c.env.DB, member.householdId);
  const id = results[0]!.meta.last_row_id;
  return c.json({ dog: await getDog(c.env.DB, id, MEDIA_BASE) }, 201);
});

// 名前などの変更(C-08)。犬種とサイズは変えられない
dogRoutes.patch('/dogs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const member = await requireOwnDog(c, id);
  const patch = await parseJson(c, dogPatchSchema);
  const db = c.env.DB;
  const current = await db
    .prepare("SELECT name, sex, birth_ym, status FROM dogs WHERE id = ?")
    .bind(id)
    .first<{ name: string; sex: string | null; birth_ym: string | null; status: string }>();
  if (!current || current.status !== 'active') {
    throw errors.conflict('dog_retired', 'このワンちゃんは登録解除されています。変更が必要なときは受付にお知らせください。');
  }
  const nowIso = toJstIso(c.get('now'));
  const actor = { type: 'member' as const, id: member.memberId };
  const columns: [keyof typeof patch, string][] = [
    ['name', 'name'],
    ['sex', 'sex'],
    ['birthYm', 'birth_ym'],
  ];
  const statements: D1PreparedStatement[] = [];
  for (const [key, col] of columns) {
    if (!(key in patch)) continue;
    const after = patch[key] ?? null;
    const before = current[col as keyof typeof current] ?? null;
    if (after === before) continue;
    statements.push(dogChangeStatement(db, id, col, before, after, actor, nowIso));
  }
  if (statements.length > 0) {
    const name = patch.name ?? current.name;
    statements.unshift(
      db
        .prepare(
          `UPDATE dogs SET name = ?, name_search = ?, sex = ?, birth_ym = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          name,
          normalizeForSearch(name),
          'sex' in patch ? (patch.sex ?? null) : current.sex,
          'birthYm' in patch ? (patch.birthYm ?? null) : current.birth_ym,
          nowIso,
          id,
        ),
      refreshAutoNameStatement(db, member.householdId, nowIso),
    );
    await db.batch(statements);
    await syncHouseholdSearchName(db, member.householdId);
  }
  return c.json({ dog: await getDog(db, id, MEDIA_BASE) });
});

// 登録解除(C-08)。過去の来場記録は残し、チェックインの選択肢には出さない(6.1)
dogRoutes.post('/dogs/:id/retire', async (c) => {
  const id = Number(c.req.param('id'));
  const member = await requireOwnDog(c, id);
  const db = c.env.DB;
  const dog = await db.prepare('SELECT status FROM dogs WHERE id = ?').bind(id).first<{ status: string }>();
  if (dog?.status !== 'active') return c.json({ dog: await getDog(db, id, MEDIA_BASE) });
  const active = await db
    .prepare("SELECT COUNT(*) AS n FROM dogs WHERE household_id = ? AND status = 'active'")
    .bind(member.householdId)
    .first<{ n: number }>();
  if ((active?.n ?? 0) <= 1) {
    throw errors.conflict(
      'last_dog',
      '最後の1頭は登録解除できません。新しいワンちゃんを追加してから、登録解除してください。',
    );
  }
  const nowIso = toJstIso(c.get('now'));
  await db.batch([
    db.prepare("UPDATE dogs SET status = 'retired', updated_at = ? WHERE id = ?").bind(nowIso, id),
    dogChangeStatement(db, id, 'status', 'active', 'retired', { type: 'member', id: member.memberId }, nowIso),
    refreshAutoNameStatement(db, member.householdId, nowIso),
  ]);
  await syncHouseholdSearchName(db, member.householdId);
  return c.json({ dog: await getDog(db, id, MEDIA_BASE) });
});

// 犬の写真の登録・差し替え(C-02、C-08)
dogRoutes.post('/dogs/:id/photo', async (c) => {
  const id = Number(c.req.param('id'));
  const member = await requireOwnDog(c, id);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw errors.badRequest('写真を受け取れませんでした。写真を選び直して、もう一度お試しください。');
  }
  await saveDogPhoto(c.env.DB, c.env.MEDIA, id, form, { type: 'member', id: member.memberId }, c.get('now'));
  return c.json({ dog: await getDog(c.env.DB, id, MEDIA_BASE) });
});
