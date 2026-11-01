import {
  PHOTO_DOWNLOAD_TTL_SECONDS,
  PHOTO_ERROR_CODES,
  downloadAllowance,
  purchasedViewUrl,
  toHex,
  toJstDate,
  toJstIso,
  type DownloadResponse,
  type PurchasesResponse,
  type Settings,
} from '@dr/shared';
import type { Bindings } from '../../env';
import { AppError } from '../../lib/errors';
import { signFileToken, verifyFileToken } from '../../lib/photos/file-token';
import { fileTokenSecret, type PhotoStorage } from '../../lib/photos/storage';
import { storeZipSize, storeZipStream, uniqueZipNames, type ZipEntry } from './zip';

// PU-7 購入した写真と再ダウンロード(PF-7。docs/photo-requirements.md 3.7)。
// - 取れるかどうかは、購入の権利(entitlements。revoked_at IS NULL)だけで決める。ほかの人の権利・返金した権利では取れない。
// - 原本は押すたびに5分の URL(R2 の署名つき URL / 代わりの置き場所の Worker の受け取り口)。
// - 回数の上限: 写真1枚につき photo_download_limit(既定 24時間で10回)。ZIP の1枚も1回に数える。download_logs に残す(IP はハッシュ)。
// - 購入した写真は、販売終了のあとも見られる(purchased_key と、売れた写真の中サイズのファイルは消さない)。

type Limit = Settings['photo_download_limit'];

/** 有効な権利と、写真のファイル */
export type EntitledPhoto = {
  entitlementId: number;
  photoId: number;
  filename: string;
  contentType: string;
  bytes: number;
  /** 受け取るファイル(購入済み領域。まだコピーしていなければ原本) */
  fileKey: string | null;
  viewKey: string | null;
  grantedAt: string;
};

type EntRow = {
  entitlement_id: number;
  photo_id: number;
  original_filename: string;
  content_type: string;
  bytes: number;
  purchased_key: string | null;
  original_key: string;
  view_key: string | null;
  files_deleted_at: string | null;
  granted_at: string;
};

const ENT_SELECT = `SELECT e.id AS entitlement_id, e.photo_id, e.granted_at, p.original_filename, p.content_type, p.bytes,
                           p.purchased_key, p.original_key, p.view_key, p.files_deleted_at
                      FROM entitlements e JOIN photos p ON p.id = e.photo_id
                     WHERE e.customer_id = ? AND e.revoked_at IS NULL`;

function toEntitled(r: EntRow): EntitledPhoto {
  return {
    entitlementId: r.entitlement_id,
    photoId: r.photo_id,
    filename: r.original_filename,
    contentType: r.content_type,
    bytes: r.bytes,
    // 購入済み領域のファイルがなければ(コピーの前)、同じバイトの原本を渡す。販売終了で消したあとは渡せない
    fileKey: r.purchased_key ?? (r.files_deleted_at ? null : r.original_key),
    viewKey: r.view_key,
    grantedAt: r.granted_at,
  };
}

export const notEntitled = () =>
  new AppError(
    403,
    PHOTO_ERROR_CODES.notEntitled,
    'この写真は、購入した写真の中にありません。購入した写真の画面を読み込み直してください。返金した写真はダウンロードできません。',
  );

const fileMissing = () =>
  new AppError(
    409,
    'photo_file_missing',
    '写真のファイルを準備できませんでした。少し待ってから、もう一度お試しください。続くときは、お店に知らせてください。',
  );

/** その購入者の、有効な権利(1枚)。なければ null */
export async function findEntitlement(db: D1Database, customerId: number, photoId: number): Promise<EntitledPhoto | null> {
  const row = await db.prepare(`${ENT_SELECT} AND e.photo_id = ? LIMIT 1`).bind(customerId, photoId).first<EntRow>();
  return row ? toEntitled(row) : null;
}

/** その購入者の、有効な権利(複数)。写真の番号の順ではなく、渡した順で返す */
export async function findEntitlements(db: D1Database, customerId: number, photoIds: number[]): Promise<Map<number, EntitledPhoto>> {
  const out = new Map<number, EntitledPhoto>();
  if (!photoIds.length) return out;
  const marks = photoIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`${ENT_SELECT} AND e.photo_id IN (${marks})`)
    .bind(customerId, ...photoIds)
    .all<EntRow>();
  for (const r of results) out.set(r.photo_id, toEntitled(r));
  return out;
}

// ---------------------------------------------------------------- 回数の上限

const windowStart = (now: Date, limit: Limit) => toJstIso(new Date(now.getTime() - limit.hours * 3600_000));

/** 写真ごとの、窓の中のダウンロードの日時 */
async function recentDownloads(db: D1Database, customerId: number, now: Date, limit: Limit, photoIds?: number[]): Promise<Map<number, string[]>> {
  const filter = photoIds?.length ? ` AND photo_id IN (${photoIds.map(() => '?').join(',')})` : '';
  const { results } = await db
    .prepare(`SELECT photo_id, created_at FROM download_logs WHERE customer_id = ? AND created_at > ?${filter}`)
    .bind(customerId, windowStart(now, limit), ...(photoIds ?? []))
    .all<{ photo_id: number; created_at: string }>();
  const out = new Map<number, string[]>();
  for (const r of results) out.set(r.photo_id, [...(out.get(r.photo_id) ?? []), r.created_at]);
  return out;
}

/** "2026-11-03T15:20:00+09:00" → "11月3日 15:20" */
function formatJst(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}月${d}日 ${Number(iso.slice(11, 13))}:${iso.slice(14, 16)}`;
}

/** 上限を超えたとき(429)。いつからまたできるかを伝える */
export function downloadLimitError(limit: Limit, resetsAt: string | null, photoIds: number[]): AppError {
  const when = resetsAt ? `${formatJst(resetsAt)}ごろから、またダウンロードできます。` : 'しばらく待ってから、もう一度お試しください。';
  return new AppError(
    429,
    PHOTO_ERROR_CODES.downloadLimit,
    `ダウンロードは、写真1枚につき${limit.hours}時間で${limit.count}回までです。${when}困ったときは、お店に知らせてください。`,
    { resetsAt, photoIds },
  );
}

export type DownloadContext = {
  db: D1Database;
  env: Bindings;
  storage: PhotoStorage;
  customerId: number;
  now: Date;
  origin: string;
  limit: Limit;
  ipHash: string | null;
  userAgent: string | null;
};

/**
 * download_logs に1行入れる。窓の中の回数が上限より少ないときだけ入る(同時に押されても上限を超えない)。入ったら true
 */
function logStatement(ctx: DownloadContext, ent: EntitledPhoto, kind: 'original' | 'zip') {
  return ctx.db
    .prepare(
      `INSERT INTO download_logs (customer_id, photo_id, entitlement_id, kind, ip_hash, user_agent, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
        WHERE (SELECT COUNT(*) FROM download_logs WHERE customer_id = ?1 AND photo_id = ?2 AND created_at > ?8) < ?9`,
    )
    .bind(ctx.customerId, ent.photoId, ent.entitlementId, kind, ctx.ipHash, ctx.userAgent, toJstIso(ctx.now), windowStart(ctx.now, ctx.limit), ctx.limit.count);
}

/** 上限に達していれば、429 を投げる(いつからまたできるか) */
async function assertAllowed(ctx: DownloadContext, photoIds: number[]): Promise<void> {
  const recent = await recentDownloads(ctx.db, ctx.customerId, ctx.now, ctx.limit, photoIds);
  const blocked: { photoId: number; resetsAt: string | null }[] = [];
  for (const id of photoIds) {
    const a = downloadAllowance(recent.get(id) ?? [], ctx.now, ctx.limit);
    if (!a.allowed) blocked.push({ photoId: id, resetsAt: a.resetsAt });
  }
  if (blocked.length) {
    const latest = blocked.map((b) => b.resetsAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
    // 管理者に知らせる: 記録はダウンロードの記録(PA-6)と、毎晩の処理の結果(システムの状態)に出る
    console.warn(`[photos] ダウンロードの上限: customer=${ctx.customerId} photos=${blocked.map((b) => b.photoId).join(',')}`);
    throw downloadLimitError(ctx.limit, latest, blocked.map((b) => b.photoId));
  }
}

/** 原本1枚の5分の URL(POST /api/photos/purchases/:photoId/download) */
export async function issueDownload(ctx: DownloadContext, photoId: number): Promise<DownloadResponse> {
  const ent = await findEntitlement(ctx.db, ctx.customerId, photoId);
  if (!ent) throw notEntitled();
  if (!ent.fileKey) throw fileMissing();
  await assertAllowed(ctx, [photoId]);
  const logged = await logStatement(ctx, ent, 'original').run();
  // 同時に押されて、確かめたあとに上限に達した
  if ((logged.meta.changes ?? 0) !== 1) {
    await assertAllowed(ctx, [photoId]);
    throw downloadLimitError(ctx.limit, null, [photoId]);
  }
  const { url, expiresAt } = await ctx.storage.downloadUrl({
    key: ent.fileKey,
    filename: ent.filename,
    contentType: ent.contentType,
    origin: ctx.origin,
    now: ctx.now,
    expiresIn: PHOTO_DOWNLOAD_TTL_SECONDS,
  });
  return { url, expiresAt, filename: ent.filename };
}

// ---------------------------------------------------------------- ZIP

/** ZIP の受け取り口の署名の中身。c = 購入者、p = 写真、n = ファイル名 */
type ZipToken = { e: number; z: 1; c: number; p: number[]; n: string };

export const zipSecretMissing = () =>
  new AppError(
    503,
    'zip_not_configured',
    'まとめてダウンロードは、いまは使えません。1枚ずつダウンロードしてください。続くときは、お店に知らせてください。',
  );

export const linkExpired = () =>
  new AppError(410, 'link_expired', 'ダウンロードの期限(5分)が切れました。購入した写真の画面から、もう一度ダウンロードしてください。');

/** まとめて ZIP の5分の URL(POST /api/photos/purchases/zip)。1枚ずつ回数に数える */
export async function issueZip(ctx: DownloadContext, photoIds: number[], facilityName: string): Promise<DownloadResponse> {
  const secret = fileTokenSecret(ctx.env);
  if (!secret) throw zipSecretMissing();
  const ents = await findEntitlements(ctx.db, ctx.customerId, photoIds);
  const missing = photoIds.filter((id) => !ents.has(id));
  if (missing.length) {
    const e = notEntitled();
    throw new AppError(e.status, e.code, e.message, { photoIds: missing });
  }
  if (photoIds.some((id) => !ents.get(id)!.fileKey)) throw fileMissing();
  await assertAllowed(ctx, photoIds);
  const results = await ctx.db.batch(photoIds.map((id) => logStatement(ctx, ents.get(id)!, 'zip')));
  if (results.some((r) => (r.meta.changes ?? 0) !== 1)) {
    await assertAllowed(ctx, photoIds);
    throw downloadLimitError(ctx.limit, null, photoIds);
  }
  const e = Math.floor(ctx.now.getTime() / 1000) + PHOTO_DOWNLOAD_TTL_SECONDS;
  const filename = `${facilityName.replace(/[\\/:*?"<>|\s]+/g, '') || '写真'}_写真_${toJstDate(ctx.now).replaceAll('-', '')}.zip`;
  const payload: ZipToken = { e, z: 1, c: ctx.customerId, p: photoIds, n: filename };
  const token = await signFileToken(secret, payload);
  return { url: `${ctx.origin}/api/photos/files/zip/${token}`, expiresAt: toJstIso(new Date(e * 1000)), filename };
}

/**
 * ZIP の受け取り口(GET /api/photos/files/zip/:token。認証なし・署名で守る)。
 * 署名と期限を確かめ、もう一度、権利がまだ有効かを確かめてから、無圧縮でつなげて流す
 */
export async function streamZip(env: Bindings, storage: PhotoStorage, token: string, now: Date): Promise<Response> {
  const secret = fileTokenSecret(env);
  if (!secret) throw zipSecretMissing();
  const p = await verifyFileToken<ZipToken>(secret, token, now);
  if (!p || p.z !== 1 || typeof p.c !== 'number' || !Array.isArray(p.p) || !p.p.every((x) => Number.isInteger(x))) throw linkExpired();
  const ents = await findEntitlements(env.DB, p.c, p.p);
  // URL を作ったあとに返金された写真は入れない
  const list = p.p.map((id) => ents.get(id)).filter((x): x is EntitledPhoto => !!x && !!x.fileKey);
  if (!list.length) throw notEntitled();
  const names = uniqueZipNames(list.map((x) => x.filename));
  const entries: ZipEntry[] = list.map((x, i) => ({
    name: names[i]!,
    size: x.bytes,
    modified: new Date(x.grantedAt),
    open: async () => {
      const f = await storage.get(x.fileKey!);
      if (!f) throw new Error(`zip: file not found for photo ${x.photoId}`);
      return f.body as ReadableStream<Uint8Array>;
    },
  }));
  const total = storeZipSize(entries);
  let body: ReadableStream<Uint8Array> = storeZipStream(entries);
  // Workers では長さの決まった流れにする(ダウンロードの進み具合が出る)。ブラウザ(デモ)にはないので、そのまま流す
  const FLS = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
  const headers: Record<string, string> = {
    'content-type': 'application/zip',
    'content-disposition': contentDispositionZip(p.n),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  };
  if (FLS) {
    const t = new FLS(total);
    void body.pipeTo(t.writable).catch((e) => console.error('[photos] ZIP を流せませんでした', e));
    body = t.readable;
    headers['content-length'] = String(total);
  }
  return new Response(body, { headers });
}

function contentDispositionZip(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// ---------------------------------------------------------------- 一覧と中サイズ

/** 購入した写真(アルバム別。GET /api/photos/purchases)。販売終了のアルバムの写真も出す */
export async function listPurchases(db: D1Database, customerId: number, now: Date, limit: Limit): Promise<PurchasesResponse> {
  const { results } = await db
    .prepare(
      `SELECT e.photo_id, e.granted_at, oi.album_id, a.name AS album_name, a.event_date, p.original_filename, p.view_key,
              COALESCE(ap.sort_order, 1000000) AS sort_order
         FROM entitlements e
         JOIN order_items oi ON oi.id = e.order_item_id
         JOIN albums a ON a.id = oi.album_id
         JOIN photos p ON p.id = e.photo_id
         LEFT JOIN album_photos ap ON ap.album_id = oi.album_id AND ap.photo_id = e.photo_id
        WHERE e.customer_id = ? AND e.revoked_at IS NULL
        ORDER BY a.event_date DESC, a.id DESC, sort_order, e.photo_id`,
    )
    .bind(customerId)
    .all<{
      photo_id: number;
      granted_at: string;
      album_id: number;
      album_name: string;
      event_date: string;
      original_filename: string;
      view_key: string | null;
    }>();
  const recent = await recentDownloads(db, customerId, now, limit);
  const albums: PurchasesResponse['albums'] = [];
  const byId = new Map<number, PurchasesResponse['albums'][number]>();
  for (const r of results) {
    let album = byId.get(r.album_id);
    if (!album) {
      album = { albumId: r.album_id, name: r.album_name, eventDate: r.event_date, photos: [] };
      byId.set(r.album_id, album);
      albums.push(album);
    }
    album.photos.push({
      photoId: r.photo_id,
      filename: r.original_filename,
      viewUrl: r.view_key ? purchasedViewUrl(r.photo_id) : null,
      downloadsRemaining: downloadAllowance(recent.get(r.photo_id) ?? [], now, limit).remaining,
      purchasedAt: r.granted_at,
    });
  }
  return { albums };
}

/** 透かしなしの中サイズ(GET /api/photos/purchases/:photoId/view)。権利がある人だけ */
export async function viewImage(db: D1Database, storage: PhotoStorage, customerId: number, photoId: number): Promise<Response> {
  const ent = await findEntitlement(db, customerId, photoId);
  if (!ent) throw notEntitled();
  const f = ent.viewKey ? await storage.get(ent.viewKey) : null;
  if (!f) throw new AppError(404, 'not_found', '写真を表示できませんでした。ダウンロードはできます。続くときは、お店に知らせてください。');
  return new Response(f.body, {
    headers: {
      'content-type': f.contentType || 'image/jpeg',
      'content-length': String(f.size),
      // 本人のスマホの中だけに保存させる(誰でも開ける URL にしない)
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}

// ---------------------------------------------------------------- IP のハッシュ

/** IP アドレスそのものは残さない。秘密を混ぜたハッシュ(HMAC-SHA256 の頭 32 文字) */
export async function ipHashOf(env: Bindings, ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const secret = env.PHOTO_URL_SECRET?.trim() || env.STRIPE_WEBHOOK_SECRET?.trim() || 'dr-photo-ip';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`ip:${ip}`));
  return toHex(sig).slice(0, 32);
}
