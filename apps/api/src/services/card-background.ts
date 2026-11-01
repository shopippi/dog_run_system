import {
  CARD_PHOTO_MAX_BYTES,
  parseCardBackground,
  toJstIso,
  type CardBackground,
} from '@dr/shared';
import { errors } from '../lib/errors';
import { auditStatement } from './audit';

/** おうちの会員証の背景(C-06)。保存されていなければ初期値(墨) */
export async function loadCardBackground(db: D1Database, householdId: number): Promise<CardBackground> {
  const row = await db
    .prepare('SELECT card_background FROM households WHERE id = ?')
    .bind(householdId)
    .first<{ card_background: string | null }>();
  return parseCardBackground(row?.card_background);
}

/**
 * 会員証の背景を変える。おうちの家族の誰でも変えられる。
 * 前の値(写真のキーを含む)は操作ログに残す。写真のファイルは消さない(元に戻せるように)。
 */
export async function saveCardBackground(
  db: D1Database,
  householdId: number,
  memberId: number,
  next: CardBackground,
  now: Date,
): Promise<CardBackground> {
  const before = await loadCardBackground(db, householdId);
  const nowIso = toJstIso(now);
  await db.batch([
    db
      .prepare('UPDATE households SET card_background = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(next), nowIso, householdId),
    auditStatement(db, {
      staffId: null,
      actor: { type: 'member', id: memberId },
      action: 'household.card_background',
      targetType: 'household',
      targetId: householdId,
      before,
      after: next,
      now,
    }),
  ]);
  return next;
}

const IMAGE_TYPES = [
  { ext: 'jpg', type: 'image/jpeg', test: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    type: 'image/png',
    test: (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    ext: 'webp',
    type: 'image/webp',
    test: (b: Uint8Array) =>
      String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' &&
      String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP',
  },
] as const;

/**
 * 会員証の背景の写真を保存する。JPEG・PNG・WebP で 1.8MB 以下(スマホで縮小してから送られてくる)。
 * キーは cards/<おうちのID>/<uuid>.<拡張子>。
 */
export async function saveCardPhoto(
  media: R2Bucket,
  householdId: number,
  form: FormData,
): Promise<CardBackground> {
  const photo = form.get('photo');
  if (!(photo instanceof File)) {
    throw errors.badRequest('写真を受け取れませんでした。写真を選び直して、もう一度お試しください。');
  }
  if (photo.size > CARD_PHOTO_MAX_BYTES) {
    throw errors.badRequest('写真が大きすぎます(1.8MB まで)。画面を読み込み直して、もう一度写真を選んでください。');
  }
  const bytes = new Uint8Array(await photo.arrayBuffer());
  if (bytes.length > CARD_PHOTO_MAX_BYTES) {
    throw errors.badRequest('写真が大きすぎます(1.8MB まで)。画面を読み込み直して、もう一度写真を選んでください。');
  }
  const kind = bytes.length >= 12 ? IMAGE_TYPES.find((t) => t.test(bytes)) : undefined;
  if (!kind) {
    throw errors.badRequest('写真の形式に対応していません。別の写真を選ぶか、カメラで撮り直してください。');
  }
  const key = `cards/${householdId}/${crypto.randomUUID()}.${kind.ext}`;
  await media.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  return { kind: 'photo', key };
}

/** その写真が、指定したおうちのいまの会員証の背景かどうか */
export async function isHouseholdCardMedia(db: D1Database, householdId: number, key: string): Promise<boolean> {
  if (!key.startsWith('cards/')) return false;
  const bg = await loadCardBackground(db, householdId);
  return bg.kind === 'photo' && bg.key === key;
}
