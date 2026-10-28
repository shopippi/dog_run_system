import {
  DOG_FIELD_LABELS,
  DOG_SEX_LABELS,
  DOG_SIZE_LABELS,
  DOG_STATUS_LABELS,
  normalizeForSearch,
  toJstIso,
  type AdminDogDetail,
  type AdminDogPatch,
  type DogSex,
  type DogSize,
  type DogStatus,
  type HouseholdStatus,
} from '@dr/shared';
import { errors } from '../lib/errors';
import { ADMIN_MEDIA_BASE } from './admin-visits';
import { auditStatement } from './audit';
import { dogChangeStatement, getDog, listBreeds, refreshAutoNameStatement, syncHouseholdSearchName } from './dogs';
import type { AuditRow, UndoContext } from './undo';

const dogNotFound = () => errors.notFound('ワンちゃんが見つかりませんでした。おうちの詳細を開き直してください。');

type DogRow = {
  id: number;
  household_id: number;
  name: string;
  breed_id: number;
  breed_other: string | null;
  breed_name: string;
  size: DogSize;
  sex: DogSex | null;
  birth_ym: string | null;
  status: DogStatus;
  photo_key: string | null;
  thumb_key: string | null;
  household_status: HouseholdStatus;
};

async function loadDogRow(db: D1Database, id: number): Promise<DogRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return db
    .prepare(
      `SELECT d.id, d.household_id, d.name, d.breed_id, d.breed_other, b.name AS breed_name, d.size, d.sex, d.birth_ym,
              d.status, d.photo_key, d.thumb_key, h.status AS household_status
         FROM dogs d JOIN breeds b ON b.id = d.breed_id JOIN households h ON h.id = d.household_id
        WHERE d.id = ?`,
    )
    .bind(id)
    .first<DogRow>();
}

/** 変えられる犬か(統合でまとめられた犬・統合済みのおうちの犬は変えない) */
export async function requireEditableDog(db: D1Database, id: number): Promise<DogRow> {
  const dog = await loadDogRow(db, id);
  if (!dog) throw dogNotFound();
  if (dog.status === 'merged' || dog.household_status !== 'active') {
    throw errors.conflict(
      'dog_merged',
      'このワンちゃんは、おうちの統合で別のワンちゃんにまとめられています。まとめた先のおうちから変更してください。',
    );
  }
  return dog;
}

/** 変更履歴の値を、画面に出す形にする */
function displayValue(field: string, v: string | null): string | null {
  if (v === null) return null;
  if (field === 'size') return DOG_SIZE_LABELS[v as DogSize] ?? v;
  if (field === 'sex') return DOG_SEX_LABELS[v as DogSex] ?? v;
  if (field === 'status') return DOG_STATUS_LABELS[v as DogStatus] ?? v;
  if (field === 'birth_ym') {
    const m = v.match(/^(\d{4})-(\d{2})$/);
    return m ? `${m[1]}年${Number(m[2])}月` : v;
  }
  if (field === 'photo') return '写真あり';
  return v;
}

/** 犬の編集画面(M-07)の内容 */
export async function getAdminDogDetail(db: D1Database, id: number): Promise<AdminDogDetail> {
  const row = await loadDogRow(db, id);
  if (!row) throw dogNotFound();
  const dog = (await getDog(db, id, ADMIN_MEDIA_BASE))!;
  const household = (await db
    .prepare('SELECT id, member_no AS memberNo, display_name AS displayName, status FROM households WHERE id = ?')
    .bind(row.household_id)
    .first<AdminDogDetail['household']>())!;
  const breeds = await listBreeds(db, true);
  const { results: visible } = await db.prepare('SELECT id FROM breeds WHERE visible = 1').all<{ id: number }>();
  const shown = new Set([...visible.map((b) => b.id), row.breed_id]);
  const { results: changes } = await db
    .prepare(
      `SELECT c.id, c.field, c.before_value, c.after_value, c.reason, c.actor_type, c.changed_at,
              CASE c.actor_type WHEN 'staff' THEN s.name WHEN 'member' THEN m.line_display_name END AS actor_name
         FROM dog_changes c
         LEFT JOIN staff_users s ON c.actor_type = 'staff' AND s.id = c.actor_id
         LEFT JOIN family_members m ON c.actor_type = 'member' AND m.id = c.actor_id
        WHERE c.dog_id = ? ORDER BY c.changed_at DESC, c.id DESC LIMIT 100`,
    )
    .bind(id)
    .all<{ id: number; field: string; before_value: string | null; after_value: string | null; reason: string | null; actor_type: string; changed_at: string; actor_name: string | null }>();
  return {
    dog,
    household,
    breeds: breeds.filter((b) => shown.has(b.id)),
    changes: changes.map((c) => ({
      id: c.id,
      at: c.changed_at,
      fieldLabel: DOG_FIELD_LABELS[c.field] ?? c.field,
      before: c.field === 'photo' ? (c.before_value ? '前の写真' : null) : displayValue(c.field, c.before_value),
      after: c.field === 'photo' ? (c.after_value ? '新しい写真' : null) : displayValue(c.field, c.after_value),
      reason: c.reason,
      actorName:
        c.actor_type === 'system' ? '自動処理' : c.actor_type === 'member' ? `${c.actor_name ?? ''}さん(お客さん)` : (c.actor_name ?? ''),
    })),
  };
}

/** 犬の値(変更前後の比べと、元に戻すために保存する形) */
type DogValues = {
  name?: string;
  breedId?: number;
  breedOther?: string | null;
  breedName?: string;
  size?: DogSize;
  sex?: DogSex | null;
  birthYm?: string | null;
  status?: 'active' | 'retired';
};

const currentValues = (d: DogRow): Required<DogValues> => ({
  name: d.name,
  breedId: d.breed_id,
  breedOther: d.breed_other,
  breedName: d.breed_other ?? d.breed_name,
  size: d.size,
  sex: d.sex,
  birthYm: d.birth_ym,
  status: d.status as 'active' | 'retired',
});

async function activeDogCount(db: D1Database, householdId: number) {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM dogs WHERE household_id = ? AND status = 'active'")
    .bind(householdId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * 値を書き込む。犬種とサイズの変更は理由つきで dog_changes に残す(6.1)。ほかの項目も履歴に残す。
 * 名前や登録の状態が変わったら、自動の呼び名を作り直す。
 */
async function writeDogValues(
  db: D1Database,
  dog: DogRow,
  before: DogValues,
  after: DogValues,
  args: { staffId: number; reason: string | null; now: Date; extra?: D1PreparedStatement[] },
) {
  const nowIso = toJstIso(args.now);
  const actor = { type: 'staff' as const, id: args.staffId };
  const next = { ...currentValues(dog), ...after };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE dogs SET name = ?, name_search = ?, breed_id = ?, breed_other = ?, size = ?, sex = ?, birth_ym = ?, status = ?,
                updated_at = ? WHERE id = ?`,
      )
      .bind(next.name, normalizeForSearch(next.name), next.breedId, next.breedOther, next.size, next.sex, next.birthYm, next.status, nowIso, dog.id),
  ];
  if ('name' in after) statements.push(dogChangeStatement(db, dog.id, 'name', before.name, after.name, actor, nowIso, args.reason));
  if ('breedId' in after) statements.push(dogChangeStatement(db, dog.id, 'breed', before.breedName, after.breedName, actor, nowIso, args.reason));
  if ('size' in after) statements.push(dogChangeStatement(db, dog.id, 'size', before.size, after.size, actor, nowIso, args.reason));
  if ('sex' in after) statements.push(dogChangeStatement(db, dog.id, 'sex', before.sex, after.sex, actor, nowIso, args.reason));
  if ('birthYm' in after) statements.push(dogChangeStatement(db, dog.id, 'birth_ym', before.birthYm, after.birthYm, actor, nowIso, args.reason));
  if ('status' in after) statements.push(dogChangeStatement(db, dog.id, 'status', before.status, after.status, actor, nowIso, args.reason));
  statements.push(refreshAutoNameStatement(db, dog.household_id, nowIso), ...(args.extra ?? []));
  await db.batch(statements);
  await syncHouseholdSearchName(db, dog.household_id);
}

/** 管理者による犬の情報の変更(A-04)。変わった項目だけを書き、操作ログに前後を残す */
export async function patchDog(db: D1Database, id: number, patch: AdminDogPatch, staffId: number, now: Date) {
  const dog = await requireEditableDog(db, id);
  const cur = currentValues(dog);
  const before: DogValues = {};
  const after: DogValues = {};

  if (patch.name !== undefined && patch.name !== cur.name) {
    before.name = cur.name;
    after.name = patch.name;
  }
  if (patch.breedId !== undefined || patch.breedOther !== undefined) {
    const breedId = patch.breedId ?? cur.breedId;
    const breed = await db
      .prepare('SELECT id, name, is_other FROM breeds WHERE id = ?')
      .bind(breedId)
      .first<{ id: number; name: string; is_other: number }>();
    if (!breed) throw errors.badRequest('犬種の選択肢が変わりました。画面を読み込み直して、犬種を選び直してください。');
    const other = breed.is_other === 1 ? (patch.breedOther ?? (breedId === cur.breedId ? cur.breedOther : null)) || null : null;
    if (breed.is_other === 1 && !other) throw errors.badRequest('犬種を入力してください(「その他」を選んだときは入力が必要です)。');
    if (breedId !== cur.breedId || other !== cur.breedOther) {
      Object.assign(before, { breedId: cur.breedId, breedOther: cur.breedOther, breedName: cur.breedName });
      Object.assign(after, { breedId, breedOther: other, breedName: other ?? breed.name });
    }
  }
  if (patch.size !== undefined && patch.size !== cur.size) {
    before.size = cur.size;
    after.size = patch.size;
  }
  if (patch.sex !== undefined && patch.sex !== cur.sex) {
    before.sex = cur.sex;
    after.sex = patch.sex;
  }
  if (patch.birthYm !== undefined && patch.birthYm !== cur.birthYm) {
    before.birthYm = cur.birthYm;
    after.birthYm = patch.birthYm;
  }
  if (patch.status !== undefined && patch.status !== cur.status) {
    if (patch.status === 'retired' && (await activeDogCount(db, dog.household_id)) <= 1) {
      throw errors.conflict(
        'last_dog',
        '最後の1頭は登録解除できません。新しいワンちゃんを追加してから、登録解除してください。',
      );
    }
    before.status = cur.status;
    after.status = patch.status;
  }
  if (Object.keys(after).length === 0) return;

  const reason = patch.reason?.trim() || null;
  if (('breedId' in after || 'size' in after) && !reason) {
    throw errors.badRequest('犬種やサイズを変えるときは、変える理由を入力してください(分析に使う情報のため、履歴に残します)。');
  }
  await writeDogValues(db, dog, before, after, {
    staffId,
    reason,
    now,
    extra: [
      auditStatement(db, {
        staffId,
        action: 'dog.update',
        targetType: 'dog',
        targetId: id,
        before,
        after,
        reason,
        undo: { dogId: id },
        now,
      }),
    ],
  });
}

/** 犬の情報の変更を元に戻す。その後にまた同じ項目を変えていたら戻せない */
export async function undoDogUpdate(db: D1Database, log: AuditRow, ctx: UndoContext) {
  const before = JSON.parse(log.before_value ?? '{}') as DogValues;
  const after = JSON.parse(log.after_value ?? '{}') as DogValues;
  const dog = await requireEditableDog(db, Number(log.target_id));
  const cur = currentValues(dog);
  const keys = (Object.keys(after) as (keyof DogValues)[]).filter((k) => k !== 'breedName');
  if (keys.some((k) => (cur[k] ?? null) !== (after[k] ?? null))) {
    throw errors.conflict(
      'changed_since',
      'このあとに同じ項目がまた変えられているため、戻せません。ワンちゃんの編集画面で直してください。',
    );
  }
  if (after.status === 'active' && before.status === 'retired' && (await activeDogCount(db, dog.household_id)) <= 1) {
    throw errors.conflict('last_dog', '最後の1頭のため、登録解除には戻せません。ワンちゃんの編集画面で確かめてください。');
  }
  await writeDogValues(db, dog, after, before, { staffId: ctx.staffId, reason: '操作ログから元に戻した', now: ctx.now });
}

/** 写真の差し替え・回転・削除の操作ログ */
export function photoAuditStatement(
  db: D1Database,
  args: {
    staffId: number;
    dogId: number;
    action: 'dog.photo' | 'dog.photo_rotate' | 'dog.photo_remove';
    before: { photo: string | null; thumb: string | null };
    after: { photo: string | null; thumb: string | null };
    now: Date;
  },
) {
  return auditStatement(db, {
    staffId: args.staffId,
    action: args.action,
    targetType: 'dog',
    targetId: args.dogId,
    before: args.before,
    after: args.after,
    undo: { dogId: args.dogId },
    now: args.now,
  });
}

/** 写真を消す(photo_key を空にする。R2 の写真は残す) */
export async function removeDogPhoto(db: D1Database, id: number, staffId: number, now: Date) {
  const dog = await requireEditableDog(db, id);
  if (!dog.photo_key && !dog.thumb_key) {
    throw errors.conflict('no_photo', 'このワンちゃんには写真が登録されていません。画面を読み込み直してください。');
  }
  const nowIso = toJstIso(now);
  const before = { photo: dog.photo_key, thumb: dog.thumb_key };
  await db.batch([
    db.prepare('UPDATE dogs SET photo_key = NULL, thumb_key = NULL, updated_at = ? WHERE id = ?').bind(nowIso, id),
    db
      .prepare(
        `INSERT INTO dog_changes (dog_id, field, before_value, after_value, actor_type, actor_id, changed_at)
         VALUES (?, 'photo', ?, NULL, 'staff', ?, ?)`,
      )
      .bind(id, JSON.stringify(before), staffId, nowIso),
    photoAuditStatement(db, { staffId, dogId: id, action: 'dog.photo_remove', before, after: { photo: null, thumb: null }, now }),
  ]);
}

/** 写真の変更を元に戻す(前の写真のキーに戻す)。その後にまた写真を変えていたら戻せない */
export async function undoDogPhoto(db: D1Database, log: AuditRow, ctx: UndoContext) {
  const before = JSON.parse(log.before_value ?? '{}') as { photo: string | null; thumb: string | null };
  const after = JSON.parse(log.after_value ?? '{}') as { photo: string | null; thumb: string | null };
  const dog = await requireEditableDog(db, Number(log.target_id));
  if ((dog.photo_key ?? null) !== (after.photo ?? null)) {
    throw errors.conflict('changed_since', 'このあとに写真がまた変えられているため、戻せません。ワンちゃんの編集画面で写真を選び直してください。');
  }
  const nowIso = toJstIso(ctx.now);
  await db.batch([
    db.prepare('UPDATE dogs SET photo_key = ?, thumb_key = ?, updated_at = ? WHERE id = ?').bind(before.photo, before.thumb, nowIso, dog.id),
    db
      .prepare(
        `INSERT INTO dog_changes (dog_id, field, before_value, after_value, reason, actor_type, actor_id, changed_at)
         VALUES (?, 'photo', ?, ?, '操作ログから元に戻した', 'staff', ?, ?)`,
      )
      .bind(dog.id, after.photo ? JSON.stringify(after) : null, before.photo ? JSON.stringify(before) : null, ctx.staffId, nowIso),
  ]);
}
