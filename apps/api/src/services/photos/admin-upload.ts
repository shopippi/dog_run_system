import {
  PHOTO_DERIVATIVES,
  compareFileNames,
  sameSha256,
  toJstIso,
  type PhotoDerivative,
  type UploadStartInput,
  type UploadStartResponse,
  type UploadTarget,
} from '@dr/shared';
import { AppError, errors } from '../../lib/errors';
import { newPhotoKey, type PartInfo, type PhotoStorage } from '../../lib/photos/storage';
import { auditStatement } from '../audit';
import { registerAuditDetail } from '../audit-view';
import { registerUndo } from '../undo';
import { assertNotRemoved, findAlbum } from './admin-common';

// 段階1-A(管理)。PA-2 一斉アップロード(PF-2)。
// 1枚ごとに: 始める(重複を確かめ、photos と photo_uploads を作る)→ 部分の送り先 → ブラウザが原本を部分ごとに PUT
// → プレビュー・サムネイル・中サイズの送り先 → ブラウザが PUT → 完了(サーバーで SHA-256 を計算し直して比べる)。
// 原本は一度もデコードしない(バイトのまま運ぶ)。完了した写真は、アルバムに下書きで入る(並び順はファイル名の順)。
// 置き場所は PhotoStorage(R2 か代わりの置き場所)。テストで R2 の形を確かめられるよう、置き場所は引数で受け取る。

type Ctx = { staffId: number; now: Date; origin: string };

type UploadRow = {
  id: string;
  photo_id: number;
  album_id: number;
  storage: 'r2' | 'fallback';
  multipart_upload_id: string | null;
  part_size: number;
  part_count: number;
  derivatives: string;
  status: 'uploading' | 'completed' | 'aborted' | 'failed';
  original_key: string;
  preview_key: string;
  thumb_key: string;
  view_key: string;
  sha256: string;
  bytes: number;
  content_type: string;
  original_filename: string;
};

const SELECT_UPLOAD = `SELECT u.id, u.photo_id, u.album_id, u.storage, u.multipart_upload_id, u.part_size, u.part_count, u.derivatives, u.status,
  p.original_key, p.preview_key, p.thumb_key, p.view_key, p.sha256, p.bytes, p.content_type, p.original_filename
  FROM photo_uploads u JOIN photos p ON p.id = u.photo_id`;

export async function findUpload(db: D1Database, id: string): Promise<UploadRow> {
  const r = await db.prepare(`${SELECT_UPLOAD} WHERE u.id = ?`).bind(id).first<UploadRow>();
  if (!r) throw errors.notFound('送っている途中の写真が見つかりませんでした。もう一度、写真を落としてください。');
  return r;
}

function assertOpen(u: UploadRow) {
  if (u.status !== 'uploading') {
    throw errors.conflict('upload_closed', 'この写真は、もう送り終えたか、送るのをやめています。画面を読み込み直してください。');
  }
}

function assertSameStorage(u: UploadRow, storage: PhotoStorage) {
  if (u.storage !== storage.kind) {
    throw errors.conflict('upload_storage_changed', '写真の置き場所の設定が変わりました。もう一度、写真を落としてください。');
  }
}

const storageFailed = () =>
  new AppError(502, 'photo_storage_failed', '写真の置き場所に送れませんでした。少し待ってから、もう一度お試しください。続くときは製作者に知らせてください。');

/** 1枚を始める。同じアルバムに同じ SHA-256 の写真があれば duplicate。送っている途中の同じ写真があれば、その続きから */
export async function startUpload(
  db: D1Database,
  storage: PhotoStorage,
  albumId: number,
  input: UploadStartInput,
  ctx: Ctx,
): Promise<UploadStartResponse> {
  const album = await findAlbum(db, albumId);
  assertNotRemoved(album);
  if (album.status === 'ended') {
    throw errors.conflict('album_ended', 'このアルバムは販売期間が終わっています。写真は新しいアルバムに入れてください。');
  }
  const sha = input.sha256.toLowerCase();
  const dup = await db
    .prepare(
      `SELECT p.id FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
        WHERE ap.album_id = ? AND ap.status != 'removed' AND p.sha256 = ? AND p.status = 'ready' LIMIT 1`,
    )
    .bind(albumId, sha)
    .first<{ id: number }>();
  if (dup) return { duplicate: true, photoId: dup.id };

  // 途中で切れたアップロードの続き(同じアルバム・同じ写真・同じ置き場所)
  const resume = await db
    .prepare(
      `${SELECT_UPLOAD} WHERE u.album_id = ? AND u.status = 'uploading' AND u.storage = ? AND p.sha256 = ? AND p.bytes = ?
        ORDER BY u.created_at DESC LIMIT 1`,
    )
    .bind(albumId, storage.kind, sha, input.bytes)
    .first<UploadRow>();
  if (resume) {
    return { duplicate: false, photoId: resume.photo_id, uploadId: resume.id, storage: resume.storage, partSize: resume.part_size, partCount: resume.part_count };
  }

  const keys = {
    original: newPhotoKey('originals', input.contentType),
    preview: newPhotoKey('preview', 'image/jpeg'),
    thumb: newPhotoKey('thumb', 'image/jpeg'),
    view: newPhotoKey('view', 'image/jpeg'),
  };
  let multipartId: string | null;
  try {
    multipartId = await storage.createMultipart(keys.original, input.contentType, ctx.now);
  } catch {
    throw storageFailed();
  }
  const uploadId = crypto.randomUUID();
  const partCount = Math.max(1, Math.ceil(input.bytes / storage.partSize));
  const nowIso = toJstIso(ctx.now);
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO photos (original_key, preview_key, thumb_key, view_key, sha256, bytes, content_type, width, height, original_filename,
                             taken_at, status, uploaded_by_staff_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`,
      )
      .bind(
        keys.original,
        keys.preview,
        keys.thumb,
        keys.view,
        sha,
        input.bytes,
        input.contentType,
        input.width ?? null,
        input.height ?? null,
        input.filename,
        input.takenAt ?? null,
        ctx.staffId,
        nowIso,
      ),
    db
      .prepare(
        `INSERT INTO photo_uploads (id, photo_id, album_id, storage, multipart_upload_id, part_size, part_count, derivatives, status,
                                    created_by_staff_id, created_at, updated_at)
         VALUES (?, last_insert_rowid(), ?, ?, ?, ?, ?, '[]', 'uploading', ?, ?, ?)`,
      )
      .bind(uploadId, albumId, storage.kind, multipartId, storage.partSize, partCount, ctx.staffId, nowIso, nowIso),
  ]);
  return { duplicate: false, photoId: res[0]!.meta.last_row_id, uploadId, storage: storage.kind, partSize: storage.partSize, partCount };
}

/** 届いているプレビューなど(置き場所に聞く。代わりの置き場所の受け取り口は記録を書かないため) */
async function receivedDerivatives(storage: PhotoStorage, u: UploadRow): Promise<PhotoDerivative[]> {
  const out: PhotoDerivative[] = [];
  for (const kind of PHOTO_DERIVATIVES) {
    const h = await storage.head(u[`${kind}_key`]);
    if (h && h.size > 0) out.push(kind);
  }
  return out;
}

export async function uploadStatus(db: D1Database, storage: PhotoStorage, id: string, now: Date) {
  const u = await findUpload(db, id);
  let parts: PartInfo[] = [];
  let derivatives: PhotoDerivative[] = JSON.parse(u.derivatives) as PhotoDerivative[];
  if (u.status === 'uploading') {
    assertSameStorage(u, storage);
    try {
      parts = await storage.listParts(u.original_key, u.multipart_upload_id, now);
      derivatives = await receivedDerivatives(storage, u);
    } catch {
      throw storageFailed();
    }
  }
  return {
    uploadId: u.id,
    status: u.status,
    parts: parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag, size: p.size })),
    derivatives,
  };
}

export async function partTargets(db: D1Database, storage: PhotoStorage, id: string, partNumbers: number[], ctx: Ctx) {
  const u = await findUpload(db, id);
  assertOpen(u);
  assertSameStorage(u, storage);
  const parts: (UploadTarget & { partNumber: number })[] = [];
  for (const n of [...new Set(partNumbers)].sort((a, b) => a - b)) {
    if (n > u.part_count) throw errors.badRequest('送る部分の番号が正しくありません。画面を読み込み直して、もう一度写真を落としてください。');
    const t = await storage.partTarget({ key: u.original_key, uploadId: u.id, multipartId: u.multipart_upload_id, partNumber: n, origin: ctx.origin, now: ctx.now });
    parts.push({ ...t, partNumber: n });
  }
  return { parts };
}

export async function derivativeTarget(db: D1Database, storage: PhotoStorage, id: string, kind: PhotoDerivative, ctx: Ctx): Promise<UploadTarget> {
  const u = await findUpload(db, id);
  assertOpen(u);
  assertSameStorage(u, storage);
  return storage.putTarget({ key: u[`${kind}_key`], contentType: 'image/jpeg', uploadId: u.id, kind, origin: ctx.origin, now: ctx.now });
}

/** 並び順: ファイル名の順。下書きの写真が続く最後の部分にだけ、ファイル名の順で差し込む(手で並べた公開中の写真は動かさない) */
async function placeByFilename(db: D1Database, albumId: number, photoId: number, filename: string, nowIso: string): Promise<D1PreparedStatement[]> {
  const { results } = await db
    .prepare(
      `SELECT ap.photo_id, ap.status, ap.sort_order, p.original_filename FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
        WHERE ap.album_id = ? AND ap.status != 'removed' ORDER BY ap.sort_order, ap.id`,
    )
    .bind(albumId)
    .all<{ photo_id: number; status: string; sort_order: number; original_filename: string }>();
  let tailStart = results.length;
  while (tailStart > 0 && results[tailStart - 1]!.status === 'draft') tailStart--;
  const base = tailStart > 0 ? results[tailStart - 1]!.sort_order : 0;
  const tail = results.slice(tailStart).map((r) => ({ id: r.photo_id, name: r.original_filename, old: r.sort_order }));
  tail.push({ id: photoId, name: filename, old: -1 });
  tail.sort((a, b) => compareFileNames(a.name, b.name) || (a.old === -1 ? 1 : b.old === -1 ? -1 : a.old - b.old));
  const moves = tail.map((t, i) => ({ id: t.id, o: base + i + 1, old: t.old })).filter((t) => t.id !== photoId && t.o !== t.old);
  const mine = base + tail.findIndex((t) => t.id === photoId) + 1;
  const out: D1PreparedStatement[] = [];
  if (moves.length) {
    out.push(
      db
        .prepare(
          `UPDATE album_photos SET sort_order = json_extract(j.value, '$.o'), updated_at = ? FROM json_each(?) AS j
            WHERE album_photos.album_id = ? AND album_photos.photo_id = json_extract(j.value, '$.id')`,
        )
        .bind(nowIso, JSON.stringify(moves.map((m) => ({ id: m.id, o: m.o }))), albumId),
    );
  }
  out.push(
    db
      .prepare(
        `INSERT INTO album_photos (album_id, photo_id, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)
         ON CONFLICT (album_id, photo_id) DO UPDATE SET status = 'draft', sort_order = excluded.sort_order, price_override = NULL,
           published_at = NULL, updated_at = excluded.updated_at`,
      )
      .bind(albumId, photoId, mine, nowIso, nowIso),
  );
  return out;
}

/** 完了。サーバーで SHA-256 を計算し直して比べる。合えば下書きとしてアルバムに入れる。合わなければ hash_mismatch_at を入れて失敗にする */
export async function completeUpload(
  db: D1Database,
  storage: PhotoStorage,
  id: string,
  parts: { partNumber: number; etag: string }[],
  ctx: Ctx,
): Promise<{ photoId: number; verified: boolean }> {
  const u = await findUpload(db, id);
  if (u.status === 'completed') return { photoId: u.photo_id, verified: true };
  assertOpen(u);
  assertSameStorage(u, storage);
  const album = await findAlbum(db, u.album_id);
  assertNotRemoved(album);
  // プレビュー・サムネイル・中サイズが届いていること(届いていなければ、送り直してから完了する)
  const got = await receivedDerivatives(storage, u);
  const missing = PHOTO_DERIVATIVES.filter((k) => !got.includes(k));
  if (missing.length) {
    throw errors.conflict('derivatives_missing', 'プレビューの画像がまだ届いていません。もう一度、写真を落としてください。', { missing });
  }
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  if (sorted.length !== u.part_count || sorted.some((p, i) => p.partNumber !== i + 1)) {
    throw errors.conflict('parts_missing', '写真の一部がまだ届いていません。そのまま待つと、続きから送ります。');
  }
  try {
    await storage.completeMultipart(u.original_key, u.multipart_upload_id, sorted, u.content_type, ctx.now);
  } catch {
    throw errors.conflict('parts_missing', '写真の一部がまだ届いていません。そのまま待つと、続きから送ります。');
  }
  const head = await storage.head(u.original_key);
  const hash = await storage.sha256(u.original_key);
  const verified = !!head && head.size === u.bytes && !!hash && sameSha256(hash, u.sha256);
  const nowIso = toJstIso(ctx.now);
  if (!verified) {
    await db.batch([
      db.prepare("UPDATE photos SET status = 'failed', hash_mismatch_at = ? WHERE id = ?").bind(nowIso, u.photo_id),
      db.prepare("UPDATE photo_uploads SET status = 'failed', updated_at = ? WHERE id = ?").bind(nowIso, u.id),
      auditStatement(db, {
        staffId: ctx.staffId,
        action: 'photo.hash_mismatch',
        targetType: 'photo',
        targetId: u.photo_id,
        after: { albumId: u.album_id, filename: u.original_filename, expected: u.sha256, actual: hash, bytes: head?.size ?? null },
        now: ctx.now,
      }),
    ]);
    return { photoId: u.photo_id, verified: false };
  }
  await db.batch([
    db
      .prepare("UPDATE photos SET status = 'ready', sha256_verified_at = ?, uploaded_at = ? WHERE id = ? AND status = 'uploading'")
      .bind(nowIso, nowIso, u.photo_id),
    db
      .prepare("UPDATE photo_uploads SET status = 'completed', derivatives = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(got), nowIso, nowIso, u.id),
    ...(await placeByFilename(db, u.album_id, u.photo_id, u.original_filename, nowIso)),
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'photo.upload',
      targetType: 'photo',
      targetId: u.photo_id,
      after: { albumId: u.album_id, filename: u.original_filename, bytes: u.bytes },
      now: ctx.now,
    }),
  ]);
  return { photoId: u.photo_id, verified: true };
}

/** やめる。途中のファイルを消す(業務の記録ではないので消してよい。3.8)。行は残す */
export async function abortUpload(db: D1Database, storage: PhotoStorage, id: string, now: Date) {
  const u = await findUpload(db, id);
  if (u.status === 'aborted' || u.status === 'failed') return;
  assertOpen(u);
  assertSameStorage(u, storage);
  try {
    await storage.abortMultipart(u.original_key, u.multipart_upload_id, now);
    await storage.delete([u.preview_key, u.thumb_key, u.view_key], now);
  } catch {
    // 消せなかった部分は、毎晩の片付け(1-D)で消す
  }
  const nowIso = toJstIso(now);
  await db.batch([
    db.prepare("UPDATE photo_uploads SET status = 'aborted', updated_at = ? WHERE id = ? AND status = 'uploading'").bind(nowIso, u.id),
    db.prepare("UPDATE photos SET status = 'failed' WHERE id = ? AND status = 'uploading'").bind(u.photo_id),
  ]);
}

// 元に戻す: アップロードした写真を、アルバムから外す(下書きのあいだだけ。原本のファイルは残す)
registerUndo('photo.upload', async (db, log, ctx) => {
  const after = JSON.parse(log.after_value ?? '{}') as { albumId: number };
  const r = await db
    .prepare('SELECT status FROM album_photos WHERE album_id = ? AND photo_id = ?')
    .bind(after.albumId, Number(log.target_id))
    .first<{ status: string }>();
  if (!r || r.status === 'removed') throw errors.conflict('album_changed', 'この写真は、もうアルバムから外してあります。');
  if (r.status !== 'draft') throw errors.conflict('album_changed', 'この写真は、もう公開しています。外すときは、アルバムの画面で写真を選んで「アルバムから外す」を使ってください。');
  await db
    .prepare("UPDATE album_photos SET status = 'removed', updated_at = ? WHERE album_id = ? AND photo_id = ?")
    .bind(toJstIso(ctx.now), after.albumId, Number(log.target_id))
    .run();
});

registerAuditDetail('photo.upload', (_b, a) => (a?.filename ? `${a.filename}` : null));
registerAuditDetail('photo.hash_mismatch', (_b, a) => (a?.filename ? `${a.filename}(届いた写真が元の写真と一致しませんでした)` : null));
