import {
  adminPhotoPreviewUrl,
  adminPhotoThumbUrl,
  defaultSaleEndsAt,
  formatAlbumDate,
  parseFolderName,
  resolvePhotoPrice,
  toJstIso,
  type AdminAlbumDetail,
  type AdminAlbumPhoto,
  type AlbumCreateInput,
  type AlbumKind,
  type AlbumPhotoStatus,
  type AlbumUpdateInput,
  type AlbumsFromFoldersResponse,
  type BulkResult,
} from '@dr/shared';
import { errors } from '../../lib/errors';
import { auditStatement, latestAuditId } from '../audit';
import { registerAuditDetail } from '../audit-view';
import { registerUndo } from '../undo';
import { albumStats, assertNotRemoved, findAlbum, soldPhotoIds, type AlbumRow } from './admin-common';
import { assertUsablePriceList, defaultPriceListId } from './admin-price-lists';

// 段階1-A(管理)。PA-3 アルバム一覧・PA-4 アルバム編集・PF-1 アルバム・PF-4 公開。
// 管理者の変更は audit_log に残し(target_type = 'photo_album')、元に戻せるものは registerUndo で戻せるようにする。
// 物理削除しない(一覧から外す = albums.removed_at)。

type Ctx = { staffId: number; now: Date };

// ---------------------------------------------------------------- 詳細(PA-4)

type PhotoRow = {
  photo_id: number;
  original_filename: string;
  status: AlbumPhotoStatus;
  sort_order: number;
  price_override: number | null;
  thumb_key: string | null;
  preview_key: string | null;
  files_deleted_at: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
};

export async function albumDetail(db: D1Database, id: number): Promise<AdminAlbumDetail> {
  const album = await albumStats(db, id);
  const { results } = await db
    .prepare(
      `SELECT ap.photo_id, p.original_filename, ap.status, ap.sort_order, ap.price_override, p.thumb_key, p.preview_key, p.files_deleted_at,
              p.width, p.height, p.bytes
         FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
        WHERE ap.album_id = ? AND ap.status != 'removed'
        ORDER BY ap.sort_order, ap.id`,
    )
    .bind(id)
    .all<PhotoRow>();
  const sold = await soldPhotoIds(db, id);
  const { results: others } = await db
    .prepare(
      `SELECT ap2.photo_id, a.id AS album_id, a.name FROM album_photos ap
         JOIN album_photos ap2 ON ap2.photo_id = ap.photo_id AND ap2.album_id != ap.album_id AND ap2.status != 'removed'
         JOIN albums a ON a.id = ap2.album_id AND a.removed_at IS NULL
        WHERE ap.album_id = ? AND ap.status != 'removed'
        ORDER BY a.event_date DESC, a.id`,
    )
    .bind(id)
    .all<{ photo_id: number; album_id: number; name: string }>();
  const alsoIn = new Map<number, { albumId: number; name: string }[]>();
  for (const o of others) {
    const list = alsoIn.get(o.photo_id) ?? [];
    list.push({ albumId: o.album_id, name: o.name });
    alsoIn.set(o.photo_id, list);
  }
  const { removedAt: _r, ...rest } = album;
  const photos: AdminAlbumPhoto[] = results.map((r) => ({
    photoId: r.photo_id,
    filename: r.original_filename,
    status: r.status,
    sortOrder: r.sort_order,
    priceOverride: r.price_override,
    price: resolvePhotoPrice({ priceOverride: r.price_override, unitPrice: album.unitPrice }),
    thumbUrl: r.thumb_key && !r.files_deleted_at ? adminPhotoThumbUrl(r.photo_id) : null,
    previewUrl: r.preview_key && !r.files_deleted_at ? adminPhotoPreviewUrl(r.photo_id) : null,
    sold: sold.has(r.photo_id),
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    alsoIn: alsoIn.get(r.photo_id) ?? [],
  }));
  return { album: rest, photos };
}

// ---------------------------------------------------------------- 作る

const albumSnap = (a: Pick<AlbumRow, 'name' | 'kind' | 'event_date' | 'price_list_id' | 'sale_ends_at' | 'cover_photo_id'>) => ({
  name: a.name,
  kind: a.kind,
  eventDate: a.event_date,
  priceListId: a.price_list_id,
  saleEndsAt: a.sale_ends_at,
  coverPhotoId: a.cover_photo_id,
});

function insertAlbum(db: D1Database, a: { name: string; kind: AlbumKind; eventDate: string; priceListId: number; sourceFolder: string | null }, ctx: Ctx) {
  const nowIso = toJstIso(ctx.now);
  return [
    db
      .prepare(
        `INSERT INTO albums (name, kind, event_date, price_list_id, status, source_folder, created_by_staff_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      )
      .bind(a.name, a.kind, a.eventDate, a.priceListId, a.sourceFolder, ctx.staffId, nowIso, nowIso),
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'photo_album.create',
      targetType: 'photo_album',
      targetId: { sql: 'last_insert_rowid()' },
      after: { name: a.name, kind: a.kind, eventDate: a.eventDate, priceListId: a.priceListId, sourceFolder: a.sourceFolder },
      now: ctx.now,
    }),
  ];
}

export async function createAlbum(db: D1Database, input: AlbumCreateInput, ctx: Ctx) {
  const priceListId = input.priceListId ?? (await defaultPriceListId(db, input.kind));
  if (input.priceListId) await assertUsablePriceList(db, input.priceListId);
  const res = await db.batch(insertAlbum(db, { ...input, priceListId, sourceFolder: null }, ctx));
  const id = res[0]!.meta.last_row_id;
  const { removedAt: _r, unitPrice: _u, albumPrice: _a, sourceFolder: _s, ...album } = await albumStats(db, id);
  return {
    album,
    auditId: await latestAuditId(db, { action: 'photo_album.create', targetType: 'photo_album', targetId: id, staffId: ctx.staffId }),
  };
}

/** フォルダの名前からアルバムを作る。同じフォルダ名(か同じ名前)の下書きのアルバムがあれば、それを使う */
export async function albumsFromFolders(db: D1Database, folders: string[], ctx: Ctx): Promise<AlbumsFromFoldersResponse> {
  const out: AlbumsFromFoldersResponse['albums'] = [];
  const seen = new Map<string, AlbumsFromFoldersResponse['albums'][number]>();
  for (const raw of folders) {
    const folder = raw.trim();
    const parsed = parseFolderName(folder, ctx.now);
    const key = `${parsed.kind}:${parsed.name}`;
    const again = seen.get(key);
    if (again) {
      out.push({ ...again, folder, created: false });
      continue;
    }
    const existing = await db
      .prepare(
        `SELECT id, name, kind, event_date FROM albums
          WHERE removed_at IS NULL AND status = 'draft' AND kind = ? AND (source_folder = ? OR name = ?)
          ORDER BY id DESC LIMIT 1`,
      )
      .bind(parsed.kind, folder, parsed.name)
      .first<{ id: number; name: string; kind: AlbumKind; event_date: string }>();
    let item: AlbumsFromFoldersResponse['albums'][number];
    if (existing) {
      item = { folder, albumId: existing.id, name: existing.name, kind: existing.kind, eventDate: existing.event_date, created: false };
    } else {
      const priceListId = await defaultPriceListId(db, parsed.kind);
      const res = await db.batch(insertAlbum(db, { ...parsed, priceListId, sourceFolder: folder }, ctx));
      item = { folder, albumId: res[0]!.meta.last_row_id, name: parsed.name, kind: parsed.kind, eventDate: parsed.eventDate, created: true };
    }
    seen.set(key, item);
    out.push(item);
  }
  return { albums: out };
}

// ---------------------------------------------------------------- 変える(PA-4)

export async function updateAlbum(db: D1Database, id: number, input: AlbumUpdateInput, ctx: Ctx) {
  const a = await findAlbum(db, id);
  assertNotRemoved(a);
  if (input.priceListId !== undefined) await assertUsablePriceList(db, input.priceListId, a.price_list_id);
  if (input.coverPhotoId != null) {
    const on = await db
      .prepare("SELECT 1 FROM album_photos WHERE album_id = ? AND photo_id = ? AND status != 'removed'")
      .bind(id, input.coverPhotoId)
      .first();
    if (!on) throw errors.badRequest('表紙にする写真が、このアルバムに見つかりませんでした。写真を選び直してください。');
  }
  const before = albumSnap(a);
  const after = { ...before, ...input };
  if (input.saleEndsAt !== undefined) {
    if (input.saleEndsAt === null && a.status !== 'draft') {
      throw errors.badRequest('公開したアルバムの販売終了の日は、空にできません。日にちを選んでください。');
    }
    if (input.saleEndsAt && a.published_at && new Date(input.saleEndsAt).getTime() <= new Date(a.published_at).getTime()) {
      throw errors.badRequest('販売終了の日は、公開した日より後にしてください。');
    }
  }
  // 販売終了のアルバムを延長して、まだファイルが残っていれば、販売中に戻す
  const revive =
    a.status === 'ended' && !a.files_deleted_at && !!after.saleEndsAt && new Date(after.saleEndsAt).getTime() > ctx.now.getTime();
  if (input.saleEndsAt && a.status === 'ended' && a.files_deleted_at) {
    throw errors.conflict('album_files_deleted', '販売期間が終わり、売れなかった写真のファイルはもう消えています。延長はできません。新しいアルバムに写真を入れ直してください。');
  }
  if (JSON.stringify(before) === JSON.stringify(after) && !revive) return { detail: await albumDetail(db, id), auditId: null };
  await db.batch([
    db
      .prepare(
        `UPDATE albums SET name = ?, kind = ?, event_date = ?, price_list_id = ?, sale_ends_at = ?, cover_photo_id = ?,
                status = ?, ended_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        after.name,
        after.kind,
        after.eventDate,
        after.priceListId,
        after.saleEndsAt,
        after.coverPhotoId,
        revive ? 'published' : a.status,
        revive ? null : a.ended_at,
        toJstIso(ctx.now),
        id,
      ),
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'photo_album.update',
      targetType: 'photo_album',
      targetId: id,
      before: { ...before, status: a.status, endedAt: a.ended_at },
      after: { ...after, status: revive ? 'published' : a.status, endedAt: revive ? null : a.ended_at },
      now: ctx.now,
    }),
  ]);
  return {
    detail: await albumDetail(db, id),
    auditId: await latestAuditId(db, { action: 'photo_album.update', targetType: 'photo_album', targetId: id, staffId: ctx.staffId }),
  };
}

// ---------------------------------------------------------------- 公開(PF-4)

type PublishUndo = {
  album: { id: number; status: string; publishedAt: string | null; saleEndsAt: string | null };
  photoIds: number[];
};

/** 公開の文(下書きの写真を公開・アルバムを公開中に・最初の公開なら公開日時と販売終了の既定) */
async function publishPlan(db: D1Database, a: AlbumRow, ctx: Ctx, saleMonths: number) {
  if (a.removed_at) throw errors.conflict('album_removed', 'このアルバムは一覧から外してあります。先に戻してから公開してください。');
  if (a.status === 'ended') throw errors.conflict('album_ended', 'このアルバムは販売期間が終わっています。続けて売るときは、販売終了の日を延ばしてください。');
  const { results } = await db
    .prepare("SELECT photo_id FROM album_photos WHERE album_id = ? AND status = 'draft'")
    .bind(a.id)
    .all<{ photo_id: number }>();
  const photoIds = results.map((r) => r.photo_id);
  const visible = await db
    .prepare("SELECT COUNT(*) AS n FROM album_photos WHERE album_id = ? AND status IN ('draft', 'published')")
    .bind(a.id)
    .first<{ n: number }>();
  if (!visible?.n) return { error: 'no_photos' as const };
  if (a.status === 'published' && photoIds.length === 0) return { error: 'nothing' as const };
  const nowIso = toJstIso(ctx.now);
  const publishedAt = a.published_at ?? nowIso;
  const saleEndsAt = a.sale_ends_at ?? defaultSaleEndsAt(publishedAt, saleMonths);
  const undo: PublishUndo = { album: { id: a.id, status: a.status, publishedAt: a.published_at, saleEndsAt: a.sale_ends_at }, photoIds };
  const statements = [
    db
      .prepare("UPDATE album_photos SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE album_id = ? AND status = 'draft'")
      .bind(nowIso, nowIso, a.id),
    db
      .prepare("UPDATE albums SET status = 'published', published_at = ?, sale_ends_at = ?, updated_at = ? WHERE id = ?")
      .bind(publishedAt, saleEndsAt, nowIso, a.id),
  ];
  return { statements, undo, after: { publishedAt, saleEndsAt, photos: photoIds.length } };
}

const noPhotosError = () => errors.conflict('album_no_photos', 'このアルバムには、公開できる写真がありません。先に写真をアップロードしてください。');

export async function publishAlbum(db: D1Database, id: number, ctx: Ctx, saleMonths: number) {
  const a = await findAlbum(db, id);
  const plan = await publishPlan(db, a, ctx, saleMonths);
  if ('error' in plan) {
    if (plan.error === 'no_photos') throw noPhotosError();
    return { detail: await albumDetail(db, id), auditId: null };
  }
  await db.batch([
    ...plan.statements,
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'photo_album.publish',
      targetType: 'photo_album',
      targetId: id,
      before: { status: a.status, publishedAt: a.published_at, saleEndsAt: a.sale_ends_at },
      after: plan.after,
      undo: [plan.undo],
      now: ctx.now,
    }),
  ]);
  return {
    detail: await albumDetail(db, id),
    auditId: await latestAuditId(db, { action: 'photo_album.publish', targetType: 'photo_album', targetId: id, staffId: ctx.staffId }),
  };
}

/** まとめて公開。アルバムごとに公開できないときは skipped に理由(photoId の欄にアルバムの番号) */
export async function publishAlbums(db: D1Database, ids: number[], ctx: Ctx, saleMonths: number): Promise<BulkResult> {
  const statements: D1PreparedStatement[] = [];
  const undos: PublishUndo[] = [];
  const skipped: BulkResult['skipped'] = [];
  for (const id of ids) {
    let a: AlbumRow;
    try {
      a = await findAlbum(db, id);
    } catch {
      skipped.push({ photoId: id, reason: 'アルバムが見つかりませんでした。' });
      continue;
    }
    try {
      const plan = await publishPlan(db, a, ctx, saleMonths);
      if ('error' in plan) {
        skipped.push({ photoId: id, reason: plan.error === 'no_photos' ? `「${a.name}」には写真がありません。` : `「${a.name}」は、もう公開しています。` });
        continue;
      }
      statements.push(...plan.statements);
      undos.push(plan.undo);
    } catch (e) {
      skipped.push({ photoId: id, reason: `「${a.name}」: ${(e as Error).message}` });
    }
  }
  if (undos.length === 0) return { changed: 0, skipped, auditId: null };
  const target = undos[0]!.album.id;
  await db.batch([
    ...statements,
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'photo_album.publish',
      targetType: 'photo_album',
      targetId: target,
      after: { albums: undos.map((u) => u.album.id) },
      undo: undos,
      now: ctx.now,
    }),
  ]);
  return {
    changed: undos.length,
    skipped,
    auditId: await latestAuditId(db, { action: 'photo_album.publish', targetType: 'photo_album', targetId: target, staffId: ctx.staffId }),
  };
}

// ---------------------------------------------------------------- 一覧から外す・戻す

export async function removeAlbum(db: D1Database, id: number, ctx: Ctx) {
  const a = await findAlbum(db, id);
  if (a.removed_at) throw errors.conflict('album_removed', 'このアルバムは、もう一覧から外してあります。画面を読み込み直してください。');
  const sold = await soldPhotoIds(db, id);
  if (sold.size > 0) {
    throw errors.conflict(
      'photo_sold',
      `このアルバムの写真は${sold.size}枚売れているので、一覧から外せません。お客さんに見せたくないときは、写真を選んで「非公開にする」を使ってください。`,
    );
  }
  const nowIso = toJstIso(ctx.now);
  await db.batch([
    db.prepare('UPDATE albums SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL').bind(nowIso, nowIso, id),
    auditStatement(db, { staffId: ctx.staffId, action: 'photo_album.remove', targetType: 'photo_album', targetId: id, before: { name: a.name }, now: ctx.now }),
  ]);
  return { auditId: await latestAuditId(db, { action: 'photo_album.remove', targetType: 'photo_album', targetId: id, staffId: ctx.staffId }) };
}

export async function restoreAlbum(db: D1Database, id: number, ctx: Ctx) {
  const a = await findAlbum(db, id);
  if (!a.removed_at) throw errors.conflict('album_not_removed', 'このアルバムは、一覧に出ています。画面を読み込み直してください。');
  const nowIso = toJstIso(ctx.now);
  await db.batch([
    db.prepare('UPDATE albums SET removed_at = NULL, updated_at = ? WHERE id = ?').bind(nowIso, id),
    auditStatement(db, { staffId: ctx.staffId, action: 'photo_album.restore', targetType: 'photo_album', targetId: id, after: { name: a.name }, now: ctx.now }),
  ]);
  return { auditId: await latestAuditId(db, { action: 'photo_album.restore', targetType: 'photo_album', targetId: id, staffId: ctx.staffId }) };
}

// ---------------------------------------------------------------- 元に戻す(操作ログ)

const changedAlbum = () => errors.conflict('album_changed', 'このアルバムは、そのあとにまた変えられています。アルバムの画面で直してください。');

registerUndo('photo_album.create', async (db, log, ctx) => {
  const a = await findAlbum(db, Number(log.target_id));
  if (a.removed_at) throw errors.conflict('album_removed', 'このアルバムは、もう一覧から外してあります。');
  const n = await db.prepare("SELECT COUNT(*) AS n FROM album_photos WHERE album_id = ? AND status != 'removed'").bind(a.id).first<{ n: number }>();
  if (n?.n) throw errors.conflict('album_has_photos', 'このアルバムには、もう写真が入っています。外すときは、アルバムの画面で「一覧から外す」を使ってください。');
  await db.prepare('UPDATE albums SET removed_at = ?, updated_at = ? WHERE id = ?').bind(toJstIso(ctx.now), toJstIso(ctx.now), a.id).run();
});

registerUndo('photo_album.update', async (db, log, ctx) => {
  const a = await findAlbum(db, Number(log.target_id));
  const before = JSON.parse(log.before_value ?? '{}') as ReturnType<typeof albumSnap> & { status: string; endedAt: string | null };
  const after = JSON.parse(log.after_value ?? '{}') as ReturnType<typeof albumSnap> & { status: string };
  if (JSON.stringify(albumSnap(a)) !== JSON.stringify(albumSnap({
    name: after.name,
    kind: after.kind,
    event_date: after.eventDate,
    price_list_id: after.priceListId,
    sale_ends_at: after.saleEndsAt,
    cover_photo_id: after.coverPhotoId,
  }))) throw changedAlbum();
  // 販売中に戻したものは、販売終了に戻す(ファイルを消したあとは戻さない)
  const status = after.status !== before.status && a.status === after.status ? before.status : a.status;
  await db
    .prepare(
      `UPDATE albums SET name = ?, kind = ?, event_date = ?, price_list_id = ?, sale_ends_at = ?, cover_photo_id = ?, status = ?, ended_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      before.name,
      before.kind,
      before.eventDate,
      before.priceListId,
      before.saleEndsAt,
      before.coverPhotoId,
      status,
      status === before.status ? before.endedAt : a.ended_at,
      toJstIso(ctx.now),
      a.id,
    )
    .run();
});

registerUndo('photo_album.publish', async (db, log, ctx) => {
  const undos = JSON.parse(log.undo_info ?? '[]') as PublishUndo[];
  const nowIso = toJstIso(ctx.now);
  // 公開のあとに注文が入ったアルバムは戻さない(お客さんが買った写真を下書きに戻さない)
  for (const u of undos) {
    const ordered = await db
      .prepare('SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.album_id = ? AND o.created_at >= ? LIMIT 1')
      .bind(u.album.id, log.created_at)
      .first();
    if (ordered) throw errors.conflict('album_ordered', '公開したあとに、お客さんの注文が入っています。公開を取り消せません。見せたくない写真は「非公開にする」を使ってください。');
  }
  const statements: D1PreparedStatement[] = [];
  for (const u of undos) {
    statements.push(
      db
        .prepare(
          `UPDATE album_photos SET status = 'draft', published_at = NULL, updated_at = ?
            WHERE album_id = ? AND status = 'published' AND photo_id IN (SELECT value FROM json_each(?))`,
        )
        .bind(nowIso, u.album.id, JSON.stringify(u.photoIds)),
      db
        .prepare('UPDATE albums SET status = ?, published_at = ?, sale_ends_at = ?, updated_at = ? WHERE id = ?')
        .bind(u.album.status, u.album.publishedAt, u.album.saleEndsAt, nowIso, u.album.id),
    );
  }
  await db.batch(statements);
});

registerUndo('photo_album.remove', async (db, log, ctx) => {
  const a = await findAlbum(db, Number(log.target_id));
  if (!a.removed_at) throw errors.conflict('album_not_removed', 'このアルバムは、もう一覧に戻っています。');
  await db.prepare('UPDATE albums SET removed_at = NULL, updated_at = ? WHERE id = ?').bind(toJstIso(ctx.now), a.id).run();
});

registerUndo('photo_album.restore', async (db, log, ctx) => {
  const a = await findAlbum(db, Number(log.target_id));
  if (a.removed_at) throw errors.conflict('album_removed', 'このアルバムは、もう一覧から外してあります。');
  const sold = await soldPhotoIds(db, a.id);
  if (sold.size) throw errors.conflict('photo_sold', 'このアルバムの写真は売れているので、一覧から外せません。');
  await db.prepare('UPDATE albums SET removed_at = ?, updated_at = ? WHERE id = ?').bind(toJstIso(ctx.now), toJstIso(ctx.now), a.id).run();
});

registerAuditDetail('photo_album.create', (_b, a) => (a ? `「${a.name}」(${a.kind === 'date' ? '日付' : 'イベント'}・${formatAlbumDate(a.eventDate)})` : null));
registerAuditDetail('photo_album.update', (b, a) => {
  if (!b || !a) return null;
  const parts: string[] = [];
  if (b.name !== a.name) parts.push(`名前「${b.name}」→「${a.name}」`);
  if (b.eventDate !== a.eventDate) parts.push(`開催日 ${formatAlbumDate(b.eventDate)} → ${formatAlbumDate(a.eventDate)}`);
  if (b.priceListId !== a.priceListId) parts.push('価格表を変えた');
  if (b.saleEndsAt !== a.saleEndsAt) parts.push(`販売終了 ${b.saleEndsAt ? formatAlbumDate(b.saleEndsAt.slice(0, 10)) : 'なし'} → ${a.saleEndsAt ? formatAlbumDate(a.saleEndsAt.slice(0, 10)) : 'なし'}`);
  if (b.coverPhotoId !== a.coverPhotoId) parts.push('表紙の写真を変えた');
  return parts.join('、') || null;
});
registerAuditDetail('photo_album.publish', (_b, a) => {
  if (!a) return null;
  if (Array.isArray(a.albums)) return `${a.albums.length}冊のアルバムを公開`;
  return `写真 ${a.photos}枚を公開${a.saleEndsAt ? `(販売終了 ${formatAlbumDate(String(a.saleEndsAt).slice(0, 10))})` : ''}`;
});
registerAuditDetail('photo_album.remove', (b) => (b ? `「${b.name}」を一覧から外した` : null));
registerAuditDetail('photo_album.restore', (_b, a) => (a ? `「${a.name}」を一覧に戻した` : null));
