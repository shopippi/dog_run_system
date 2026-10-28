import {
  PHOTO_MAX_BYTES,
  PHOTO_MAX_EDGE,
  THUMB_EDGE,
  THUMB_MAX_BYTES,
  formatDogNo,
  jpegSize,
  normalizeForSearch,
  toJstIso,
  type ActorType,
  type Breed,
  type DogInput,
  type DogSummary,
} from '@dr/shared';
import { errors } from '../lib/errors';

type BreedRow = { id: number; name: string; default_size: Breed['defaultSize']; is_other: number; visible: number };

export async function listBreeds(db: D1Database, includeHidden = false): Promise<Breed[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, default_size, is_other, visible FROM breeds
        ${includeHidden ? '' : 'WHERE visible = 1'}
        ORDER BY sort_order, id`,
    )
    .all<BreedRow>();
  return results.map((r) => ({ id: r.id, name: r.name, defaultSize: r.default_size, isOther: r.is_other === 1 }));
}

/**
 * 犬種が選択肢にあるかを確かめ、「その他」以外では自由入力を空にする。
 * 「その他」のときは自由入力を必須にする。
 */
export async function normalizeDogInputs(db: D1Database, dogs: DogInput[]): Promise<DogInput[]> {
  const ids = [...new Set(dogs.map((d) => d.breedId))];
  const { results } = await db
    .prepare(`SELECT id, name, default_size, is_other, visible FROM breeds WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<BreedRow>();
  const byId = new Map(results.map((r) => [r.id, r]));
  return dogs.map((d) => {
    const breed = byId.get(d.breedId);
    if (!breed) throw errors.badRequest('犬種の選択肢が変わりました。画面を読み込み直して、犬種を選び直してください。');
    if (breed.is_other === 1) {
      if (!d.breedOther) throw errors.badRequest(`「${d.name}」の犬種を入力してください(「その他」を選んだときは入力が必要です)。`);
      return d;
    }
    return { ...d, breedOther: null };
  });
}

/** 犬を追加する書き込み。犬IDは「会員ID-連番」。seqStart は、そのおうちで次に使う番号。 */
export function insertDogStatements(
  db: D1Database,
  householdId: number,
  memberNo: string,
  seqStart: number,
  dogs: DogInput[],
  nowIso: string,
): D1PreparedStatement[] {
  return dogs.map((d, i) =>
    db
      .prepare(
        `INSERT INTO dogs
           (dog_no, household_id, name, name_search, breed_id, breed_other, size, sex, birth_ym,
            status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(
        formatDogNo(memberNo, seqStart + i),
        householdId,
        d.name,
        normalizeForSearch(d.name),
        d.breedId,
        d.breedOther ?? null,
        d.size,
        d.sex ?? null,
        d.birthYm ?? null,
        nowIso,
        nowIso,
      ),
  );
}

/** そのおうちで次に使う犬IDの番号。統合で移ってきた犬の番号とは重ならないよう、会員IDで始まる犬IDから数える。 */
export async function nextDogSeq(db: D1Database, memberNo: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(CAST(substr(dog_no, ?) AS INTEGER)), 0) + 1 AS next
         FROM dogs WHERE dog_no LIKE ? || '-%'`,
    )
    .bind(memberNo.length + 2, memberNo)
    .first<{ next: number }>();
  return row?.next ?? 1;
}

type DogRow = {
  id: number;
  dog_no: string;
  name: string;
  breed_id: number;
  breed_name: string;
  breed_other: string | null;
  size: DogSummary['size'];
  sex: DogSummary['sex'];
  birth_ym: string | null;
  status: DogSummary['status'];
  photo_key: string | null;
  thumb_key: string | null;
};

const DOG_SELECT = `
  SELECT d.id, d.dog_no, d.name, d.breed_id, b.name AS breed_name, d.breed_other, d.size, d.sex, d.birth_ym,
         d.status, d.photo_key, d.thumb_key
    FROM dogs d JOIN breeds b ON b.id = d.breed_id`;

export function toDogSummary(r: DogRow, mediaBase: string): DogSummary {
  return {
    id: r.id,
    dogNo: r.dog_no,
    name: r.name,
    breedId: r.breed_id,
    breedName: r.breed_other ? r.breed_other : r.breed_name,
    breedOther: r.breed_other,
    size: r.size,
    sex: r.sex,
    birthYm: r.birth_ym,
    status: r.status,
    photoUrl: r.photo_key ? `${mediaBase}/${r.photo_key}` : null,
    thumbUrl: r.thumb_key ? `${mediaBase}/${r.thumb_key}` : null,
  };
}

/** おうちの犬の一覧。登録解除した犬は includeRetired のときだけ含める。 */
export async function listHouseholdDogs(
  db: D1Database,
  householdId: number,
  mediaBase: string,
  includeRetired = false,
): Promise<DogSummary[]> {
  const { results } = await db
    .prepare(
      `${DOG_SELECT} WHERE d.household_id = ? AND d.status ${includeRetired ? "IN ('active', 'retired')" : "= 'active'"}
       ORDER BY d.id`,
    )
    .bind(householdId)
    .all<DogRow>();
  return results.map((r) => toDogSummary(r, mediaBase));
}

export async function getDog(db: D1Database, dogId: number, mediaBase: string) {
  const row = await db.prepare(`${DOG_SELECT} WHERE d.id = ?`).bind(dogId).first<DogRow & { household_id?: number }>();
  return row ? toDogSummary(row, mediaBase) : null;
}

export async function getDogHouseholdId(db: D1Database, dogId: number): Promise<number | null> {
  const row = await db.prepare('SELECT household_id FROM dogs WHERE id = ?').bind(dogId).first<{ household_id: number }>();
  return row?.household_id ?? null;
}

/**
 * 犬の写真を保存する(C-02、C-08、A-04)。
 * スマホ側で縮小した JPEG(長い辺 800px 以下)と、一覧用の正方形の JPEG を受け取る。
 * 前の写真は消さずに残し、変更履歴(dog_changes)に前後のキーを記録する(元に戻せるようにするため)。
 */
export async function saveDogPhoto(
  db: D1Database,
  media: R2Bucket,
  dogId: number,
  form: FormData,
  actor: { type: ActorType; id: number | null },
  now: Date,
): Promise<{ photoKey: string; thumbKey: string }> {
  const photo = form.get('photo');
  const thumb = form.get('thumb');
  if (!(photo instanceof File) || !(thumb instanceof File)) {
    throw errors.badRequest('写真を受け取れませんでした。写真を選び直して、もう一度お試しください。');
  }
  const photoBytes = new Uint8Array(await photo.arrayBuffer());
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
  const photoSize = jpegSize(photoBytes);
  const thumbSize = jpegSize(thumbBytes);
  if (!photoSize || !thumbSize) {
    throw errors.badRequest('写真の形式に対応していません。別の写真を選ぶか、カメラで撮り直してください。');
  }
  if (
    photoBytes.length > PHOTO_MAX_BYTES ||
    Math.max(photoSize.width, photoSize.height) > PHOTO_MAX_EDGE ||
    thumbBytes.length > THUMB_MAX_BYTES ||
    Math.max(thumbSize.width, thumbSize.height) > THUMB_EDGE
  ) {
    throw errors.badRequest('写真が大きすぎます。画面を読み込み直して、もう一度写真を選んでください。');
  }

  const dog = await db
    .prepare('SELECT dog_no, photo_key, thumb_key FROM dogs WHERE id = ?')
    .bind(dogId)
    .first<{ dog_no: string; photo_key: string | null; thumb_key: string | null }>();
  if (!dog) throw errors.notFound('ワンちゃんが見つかりませんでした。画面を読み込み直してください。');

  const id = crypto.randomUUID();
  const photoKey = `dogs/${dog.dog_no}/${id}.jpg`;
  const thumbKey = `dogs/${dog.dog_no}/${id}_thumb.jpg`;
  const meta = { httpMetadata: { contentType: 'image/jpeg' } };
  await media.put(photoKey, photoBytes, meta);
  await media.put(thumbKey, thumbBytes, meta);

  const nowIso = toJstIso(now);
  await db.batch([
    db
      .prepare('UPDATE dogs SET photo_key = ?, thumb_key = ?, updated_at = ? WHERE id = ?')
      .bind(photoKey, thumbKey, nowIso, dogId),
    db
      .prepare(
        `INSERT INTO dog_changes (dog_id, field, before_value, after_value, actor_type, actor_id, changed_at)
         VALUES (?, 'photo', ?, ?, ?, ?, ?)`,
      )
      .bind(
        dogId,
        dog.photo_key ? JSON.stringify({ photo: dog.photo_key, thumb: dog.thumb_key }) : null,
        JSON.stringify({ photo: photoKey, thumb: thumbKey }),
        actor.type,
        actor.id,
        nowIso,
      ),
  ]);
  return { photoKey, thumbKey };
}

/** 写真を返す。誰でも開ける URL にはせず、認証つきの API からだけ返す(6.2)。 */
export async function serveMedia(media: R2Bucket, key: string): Promise<Response> {
  const obj = await media.get(key);
  if (!obj) throw errors.notFound('写真が見つかりませんでした。画面を読み込み直してください。');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // 写真は一度保存したら中身が変わらない(差し替えは新しいキーになる)
      'cache-control': 'private, max-age=86400',
    },
  });
}

/** その写真が、指定したおうちの犬の写真かどうか。 */
export async function isHouseholdDogMedia(db: D1Database, householdId: number, key: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM dogs WHERE household_id = ? AND (photo_key = ? OR thumb_key = ?) LIMIT 1')
    .bind(householdId, key, key)
    .first();
  return Boolean(row);
}

/** おうちの呼び名を自動で作る設定なら、登録中の犬の名前から作り直す(4章)。 */
export function refreshAutoNameStatement(db: D1Database, householdId: number, nowIso: string): D1PreparedStatement {
  // 犬の名前を登録順に「・」でつなぐ。犬がいなければ「おうち」
  return db
    .prepare(
      `UPDATE households
          SET display_name = COALESCE(
                (SELECT group_concat(name, '・') || 'のおうち'
                   FROM (SELECT name FROM dogs WHERE household_id = ?1 AND status = 'active' ORDER BY id)),
                'おうち'),
              updated_at = ?2
        WHERE id = ?1 AND display_name_auto = 1`,
    )
    .bind(householdId, nowIso);
}

/** 呼び名の検索用の列を、呼び名に合わせる(SQL ではひらがなにそろえられないため、あとから更新する)。 */
export async function syncHouseholdSearchName(db: D1Database, householdId: number) {
  const h = await db.prepare('SELECT display_name FROM households WHERE id = ?').bind(householdId).first<{ display_name: string }>();
  if (!h) return;
  await db
    .prepare('UPDATE households SET display_name_search = ? WHERE id = ?')
    .bind(normalizeForSearch(h.display_name), householdId)
    .run();
}

export function dogChangeStatement(
  db: D1Database,
  dogId: number,
  field: string,
  before: unknown,
  after: unknown,
  actor: { type: ActorType; id: number | null },
  nowIso: string,
  reason: string | null = null,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO dog_changes (dog_id, field, before_value, after_value, reason, actor_type, actor_id, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(dogId, field, before == null ? null : String(before), after == null ? null : String(after), reason, actor.type, actor.id, nowIso);
}

/** 来場した犬(来場の記録の順) */
export async function listVisitDogs(db: D1Database, visitId: number, mediaBase: string): Promise<DogSummary[]> {
  const { results } = await db
    .prepare(`${DOG_SELECT} JOIN visit_dogs vd ON vd.dog_id = d.id WHERE vd.visit_id = ? ORDER BY vd.id`)
    .bind(visitId)
    .all<DogRow>();
  return results.map((r) => toDogSummary(r, mediaBase));
}
