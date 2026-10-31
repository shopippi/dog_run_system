import { dogInputSchema, dogPatchSchema, normalizeForSearch, toJstIso, type DogsResponse } from '@dr/shared';
import { dogVisitRecords } from '../../services/checkins';
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

// 犬の一覧(C-08)。登録をおやすみしている犬も、過去の記録として返す
dogRoutes.get('/dogs', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const body: DogsResponse = {
    dogs: await listHouseholdDogs(c.env.DB, member.householdId, MEDIA_BASE, true),
    // ワンちゃんごとの来場の回数と最後に来た日(ワンちゃんの変更画面に出す)
    records: await dogVisitRecords(c.env.DB, member.householdId),
  };
  return c.json(body);
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

// 名前などの変更(C-08)。犬種とサイズは変えられない。体重・相性・予防注射の年は、お客さんも変えられる
dogRoutes.patch('/dogs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const member = await requireOwnDog(c, id);
  const patch = await parseJson(c, dogPatchSchema);
  const db = c.env.DB;
  const current = await db
    .prepare(
      `SELECT name, sex, birth_ym, weight_kg, sociability, rabies_vaccine_year, combo_vaccine_year, status
         FROM dogs WHERE id = ?`,
    )
    .bind(id)
    .first<Record<string, string | number | null> & { name: string; status: string }>();
  if (!current || current.status !== 'active') {
    throw errors.conflict('dog_retired', 'このワンちゃんは登録をおやすみしています。「ワンちゃん」の画面で戻してから変えてください。');
  }
  const nowIso = toJstIso(c.get('now'));
  const actor = { type: 'member' as const, id: member.memberId };
  const columns: [keyof typeof patch, string][] = [
    ['name', 'name'],
    ['sex', 'sex'],
    ['birthYm', 'birth_ym'],
    ['weightKg', 'weight_kg'],
    ['sociability', 'sociability'],
    ['rabiesVaccineYear', 'rabies_vaccine_year'],
    ['comboVaccineYear', 'combo_vaccine_year'],
  ];
  const next: Record<string, string | number | null> = { ...current };
  const statements: D1PreparedStatement[] = [];
  for (const [key, col] of columns) {
    if (!(key in patch)) continue;
    const after = patch[key] ?? null;
    const before = current[col] ?? null;
    if (after === before) continue;
    next[col] = after;
    statements.push(dogChangeStatement(db, id, col, before, after, actor, nowIso));
  }
  if (statements.length > 0) {
    const name = String(next.name);
    statements.unshift(
      db
        .prepare(
          `UPDATE dogs SET name = ?, name_search = ?, sex = ?, birth_ym = ?, weight_kg = ?, sociability = ?,
                  rabies_vaccine_year = ?, combo_vaccine_year = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          name,
          normalizeForSearch(name),
          next.sex ?? null,
          next.birth_ym ?? null,
          next.weight_kg ?? null,
          next.sociability ?? null,
          next.rabies_vaccine_year ?? null,
          next.combo_vaccine_year ?? null,
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

/** 最後の1頭は、おやすみにできない(チェックインで選ぶワンちゃんがいなくなるため) */
const lastDogMessage = '最後の1頭は、登録をおやすみできません。新しいワンちゃんを追加してから、おやすみにしてください。';

// 登録をおやすみする(C-08。内部の値は retired)。過去の来場記録は残し、チェックインの選択肢には出さない(6.1)
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
  if ((active?.n ?? 0) <= 1) throw errors.conflict('last_dog', lastDogMessage);
  const nowIso = toJstIso(c.get('now'));
  await db.batch([
    db.prepare("UPDATE dogs SET status = 'retired', updated_at = ? WHERE id = ?").bind(nowIso, id),
    dogChangeStatement(db, id, 'status', 'active', 'retired', { type: 'member', id: member.memberId }, nowIso),
    refreshAutoNameStatement(db, member.householdId, nowIso),
  ]);
  await syncHouseholdSearchName(db, member.householdId);
  return c.json({ dog: await getDog(db, id, MEDIA_BASE) });
});

// おやすみ中のワンちゃんを、登録に戻す(C-08)。チェックインでまた選べるようになる
dogRoutes.post('/dogs/:id/restore', async (c) => {
  const id = Number(c.req.param('id'));
  const member = await requireOwnDog(c, id);
  const db = c.env.DB;
  const dog = await db.prepare('SELECT status FROM dogs WHERE id = ?').bind(id).first<{ status: string }>();
  if (dog?.status === 'merged') {
    throw errors.conflict('dog_merged', 'このワンちゃんは、おうちをまとめたときに別のワンちゃんと1頭にまとめられています。「ワンちゃん」の一覧から、まとめた後の子を開いてください。');
  }
  if (dog?.status !== 'retired') return c.json({ dog: await getDog(db, id, MEDIA_BASE) });
  const nowIso = toJstIso(c.get('now'));
  await db.batch([
    db.prepare("UPDATE dogs SET status = 'active', updated_at = ? WHERE id = ?").bind(nowIso, id),
    dogChangeStatement(db, id, 'status', 'retired', 'active', { type: 'member', id: member.memberId }, nowIso),
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
