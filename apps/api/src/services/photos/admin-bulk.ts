import { toJstIso, type AlbumPhotoStatus, type AlbumPhotosBulkInput, type BulkResult } from '@dr/shared';
import { errors } from '../../lib/errors';
import { auditStatement, latestAuditId } from '../audit';
import { registerAuditDetail } from '../audit-view';
import { registerUndo } from '../undo';
import { assertNotRemoved, findAlbum, soldPhotoIds } from './admin-common';

// 段階1-A(管理)。PA-4 の写真の一括操作(PF-3・PF-4)。
// - set_price / reset_price: 写真ごとの例外価格(album_photos.price_override)。NULL なら価格表に従う
// - publish / hide: 公開・非公開
// - remove: アルバムから外す(status = 'removed'。行は消さない)。売れた写真は外さず非公開にし、skipped に理由
// - move / copy: ほかのアルバムへ。同じ photos の行を共有する(原本は1つ)。売れた写真は移せない(コピーはできる)
// - reorder: 並び順
// 1回の操作で操作ログを1行(target_type = 'photo_album')。元に戻すときは、変えた掲載の行を前の値に戻す
// (新しく足した掲載は「外した」にする)。そのあとにまた変わっていたら戻さない。

type Ctx = { staffId: number; now: Date };

type ApRow = {
  album_id: number;
  photo_id: number;
  status: AlbumPhotoStatus;
  price_override: number | null;
  published_at: string | null;
  sort_order: number;
};
/** 掲載の行の、変える前と後(null = 行がなかった) */
type Change = { albumId: number; photoId: number; before: Omit<ApRow, 'album_id' | 'photo_id'> | null; after: Omit<ApRow, 'album_id' | 'photo_id'> };

const strip = (r: ApRow) => ({ status: r.status, price_override: r.price_override, published_at: r.published_at, sort_order: r.sort_order });

async function rowsOf(db: D1Database, albumId: number, photoIds: number[]): Promise<Map<number, ApRow>> {
  const { results } = await db
    .prepare(
      `SELECT album_id, photo_id, status, price_override, published_at, sort_order FROM album_photos
        WHERE album_id = ? AND photo_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(albumId, JSON.stringify(photoIds))
    .all<ApRow>();
  return new Map(results.map((r) => [r.photo_id, r]));
}

/**
 * 掲載の行をまとめて書く(行の数によらず2つの文。D1 の1回の呼び出しの文の数を増やさないため)。
 * before が null の行は足し、ほかは after の値にする
 */
function writeChanges(db: D1Database, changes: Change[], nowIso: string): D1PreparedStatement[] {
  const enc = (c: Change) => ({ a: c.albumId, ph: c.photoId, s: c.after.status, p: c.after.price_override, u: c.after.published_at, o: c.after.sort_order });
  const inserts = changes.filter((c) => c.before === null).map(enc);
  const updates = changes.filter((c) => c.before !== null).map(enc);
  const out: D1PreparedStatement[] = [];
  if (updates.length) {
    out.push(
      db
        .prepare(
          `UPDATE album_photos SET status = json_extract(j.value, '$.s'), price_override = json_extract(j.value, '$.p'),
                  published_at = json_extract(j.value, '$.u'), sort_order = json_extract(j.value, '$.o'), updated_at = ?
             FROM json_each(?) AS j
            WHERE album_photos.album_id = json_extract(j.value, '$.a') AND album_photos.photo_id = json_extract(j.value, '$.ph')`,
        )
        .bind(nowIso, JSON.stringify(updates)),
    );
  }
  if (inserts.length) {
    out.push(
      db
        .prepare(
          `INSERT INTO album_photos (album_id, photo_id, sort_order, status, price_override, published_at, created_at, updated_at)
           SELECT json_extract(j.value, '$.a'), json_extract(j.value, '$.ph'), json_extract(j.value, '$.o'), json_extract(j.value, '$.s'),
                  json_extract(j.value, '$.p'), json_extract(j.value, '$.u'), ?, ? FROM json_each(?) AS j`,
        )
        .bind(nowIso, nowIso, JSON.stringify(inserts)),
    );
  }
  return out;
}

/** 掲載の行をまとめて読む(アルバムと写真の組) */
async function rowsOfPairs(db: D1Database, pairs: { albumId: number; photoId: number }[]): Promise<Map<string, ApRow>> {
  const { results } = await db
    .prepare(
      `SELECT ap.album_id, ap.photo_id, ap.status, ap.price_override, ap.published_at, ap.sort_order
         FROM json_each(?) AS j JOIN album_photos ap
           ON ap.album_id = json_extract(j.value, '$.albumId') AND ap.photo_id = json_extract(j.value, '$.photoId')`,
    )
    .bind(JSON.stringify(pairs.map((p) => ({ albumId: p.albumId, photoId: p.photoId }))))
    .all<ApRow>();
  return new Map(results.map((r) => [`${r.album_id}:${r.photo_id}`, r]));
}

const MESSAGES = {
  notInAlbum: 'このアルバムに載っていない写真です。',
  sold: '購入された写真なので、外さずに非公開にしました。',
  soldMove: '購入された写真は移せません。「コピー」なら、ほかのアルバムにも載せられます。',
  already: 'もう、そのアルバムに載っています。',
  nothing: '変えるところがありませんでした。',
};

export async function bulkAlbumPhotos(db: D1Database, albumId: number, input: AlbumPhotosBulkInput, ctx: Ctx): Promise<BulkResult> {
  const album = await findAlbum(db, albumId);
  assertNotRemoved(album);
  const nowIso = toJstIso(ctx.now);
  const skipped: BulkResult['skipped'] = [];
  const changes: Change[] = [];
  const current = await rowsOf(db, albumId, input.photoIds);
  // アルバムに載っている(外していない)写真だけを対象にする
  const targets: ApRow[] = [];
  for (const id of input.photoIds) {
    const r = current.get(id);
    if (!r || r.status === 'removed') skipped.push({ photoId: id, reason: MESSAGES.notInAlbum });
    else targets.push(r);
  }
  const change = (r: ApRow, patch: Partial<Omit<ApRow, 'album_id' | 'photo_id'>>) => {
    const after = { ...strip(r), ...patch };
    if (JSON.stringify(after) !== JSON.stringify(strip(r))) changes.push({ albumId: r.album_id, photoId: r.photo_id, before: strip(r), after });
  };
  let target: number | null = null;

  switch (input.action) {
    case 'set_price':
      for (const r of targets) change(r, { price_override: input.price });
      break;
    case 'reset_price':
      for (const r of targets) change(r, { price_override: null });
      break;
    case 'publish':
      for (const r of targets) change(r, { status: 'published', published_at: r.published_at ?? nowIso });
      break;
    case 'hide':
      for (const r of targets) change(r, { status: 'hidden' });
      break;
    case 'remove': {
      const sold = await soldPhotoIds(db, albumId);
      for (const r of targets) {
        if (sold.has(r.photo_id)) {
          change(r, { status: 'hidden' });
          skipped.push({ photoId: r.photo_id, reason: MESSAGES.sold });
        } else change(r, { status: 'removed' });
      }
      break;
    }
    case 'move':
    case 'copy': {
      if (input.targetAlbumId === albumId) throw errors.badRequest('移す先に、いまと同じアルバムが選ばれています。ほかのアルバムを選んでください。');
      const dest = await findAlbum(db, input.targetAlbumId);
      assertNotRemoved(dest);
      if (dest.status === 'ended') throw errors.conflict('album_ended', '移す先のアルバムは販売期間が終わっています。ほかのアルバムを選んでください。');
      target = dest.id;
      const sold = input.action === 'move' ? await soldPhotoIds(db, albumId) : new Set<number>();
      const destRows = await rowsOf(db, dest.id, targets.map((r) => r.photo_id));
      const maxRow = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM album_photos WHERE album_id = ?').bind(dest.id).first<{ m: number }>();
      let next = (maxRow?.m ?? 0) + 1;
      for (const r of targets) {
        if (sold.has(r.photo_id)) {
          skipped.push({ photoId: r.photo_id, reason: MESSAGES.soldMove });
          continue;
        }
        const d = destRows.get(r.photo_id);
        // 移す先では下書き(公開は移す先のアルバムで決める)。例外価格は持っていかない(移す先の価格表に従う)
        const fresh = { status: 'draft' as const, price_override: null, published_at: null, sort_order: next };
        if (d && d.status !== 'removed') {
          skipped.push({ photoId: r.photo_id, reason: MESSAGES.already });
        } else {
          changes.push({ albumId: dest.id, photoId: r.photo_id, before: d ? strip(d) : null, after: fresh });
          next++;
        }
        if (input.action === 'move') change(r, { status: 'removed' });
      }
      break;
    }
    case 'reorder': {
      const { results } = await db
        .prepare("SELECT album_id, photo_id, status, price_override, published_at, sort_order FROM album_photos WHERE album_id = ? AND status != 'removed' ORDER BY sort_order, id")
        .bind(albumId)
        .all<ApRow>();
      const listed = new Set(targets.map((r) => r.photo_id));
      const order = [...targets.map((r) => r.photo_id), ...results.filter((r) => !listed.has(r.photo_id)).map((r) => r.photo_id)];
      const byId = new Map(results.map((r) => [r.photo_id, r]));
      order.forEach((id, i) => {
        const r = byId.get(id);
        if (r) change(r, { sort_order: i + 1 });
      });
      break;
    }
  }

  // 表紙の写真を外した・移したときは、表紙を空にする(一覧は先頭の写真を出す)
  const coverGone = album.cover_photo_id !== null && changes.some((c) => c.albumId === albumId && c.photoId === album.cover_photo_id && c.after.status === 'removed');
  if (changes.length === 0) return { changed: 0, skipped, auditId: null };
  const changedPhotos = new Set(changes.filter((c) => c.albumId === albumId || input.action === 'copy').map((c) => c.photoId)).size;
  const statements = writeChanges(db, changes, nowIso);
  if (coverGone) statements.push(db.prepare('UPDATE albums SET cover_photo_id = NULL, updated_at = ? WHERE id = ?').bind(nowIso, albumId));
  statements.push(db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').bind(nowIso, albumId));
  // 記録が大きくなりすぎないよう、操作ログには変えた掲載の行だけを残す
  statements.push(
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'photo.bulk',
      targetType: 'photo_album',
      targetId: albumId,
      after: {
        action: input.action,
        photos: changedPhotos,
        ...(input.action === 'set_price' ? { price: input.price } : {}),
        ...(target ? { targetAlbumId: target } : {}),
      },
      undo: { changes, cover: coverGone ? album.cover_photo_id : null },
      now: ctx.now,
    }),
  );
  await db.batch(statements);
  return {
    changed: changedPhotos,
    skipped,
    auditId: await latestAuditId(db, { action: 'photo.bulk', targetType: 'photo_album', targetId: albumId, staffId: ctx.staffId }),
  };
}

registerUndo('photo.bulk', async (db, log, ctx) => {
  const info = JSON.parse(log.undo_info ?? '{}') as { changes: Change[]; cover: number | null };
  const nowIso = toJstIso(ctx.now);
  const now = await rowsOfPairs(db, info.changes);
  const back: Change[] = [];
  for (const c of info.changes) {
    const r = now.get(`${c.albumId}:${c.photoId}`);
    if (!r || JSON.stringify(strip(r)) !== JSON.stringify(c.after)) {
      throw errors.conflict('album_changed', '写真は、そのあとにまた変えられています。アルバムの画面で直してください。');
    }
    // 新しく足した掲載は、行を消さずに「外した」にする
    back.push({ albumId: c.albumId, photoId: c.photoId, before: c.after, after: c.before ?? { ...c.after, status: 'removed' } });
  }
  const statements = writeChanges(db, back, nowIso);
  if (info.cover) {
    statements.push(db.prepare('UPDATE albums SET cover_photo_id = ?, updated_at = ? WHERE id = ? AND cover_photo_id IS NULL').bind(info.cover, nowIso, Number(log.target_id)));
  }
  if (statements.length) await db.batch(statements);
});

const ACTION_LABELS: Record<AlbumPhotosBulkInput['action'], string> = {
  set_price: '価格を変えた',
  reset_price: '価格を価格表に戻した',
  publish: '公開した',
  hide: '非公開にした',
  remove: 'アルバムから外した',
  move: 'ほかのアルバムへ移した',
  copy: 'ほかのアルバムへコピーした',
  reorder: '並び順を変えた',
};
registerAuditDetail('photo.bulk', (_b, a) => {
  if (!a) return null;
  const label = ACTION_LABELS[a.action as AlbumPhotosBulkInput['action']] ?? '写真を変えた';
  return `写真 ${a.photos}枚を${label}${a.price ? `(${Number(a.price).toLocaleString('ja-JP')}円)` : ''}`;
});
