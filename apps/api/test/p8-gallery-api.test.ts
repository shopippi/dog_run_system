import { SELF, env } from 'cloudflare:test';
import type { GalleryAlbumDetail, GalleryAlbumsResponse } from '@dr/shared';
import { galleryAlbumDetailSchema, galleryAlbumsResponseSchema } from '@dr/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensurePhotoCustomer } from '../src/lib/photos/customers';
import { BASE, call } from './helpers';

// 段階1-B ギャラリー(PF-5。PU-2〜PU-4)の API。docs/photo-requirements.md 6.1・12章
// - 公開中・販売中のアルバムの、公開中の写真だけが見える(下書き・非公開・外した・販売終了は 404)
// - 購入済みの印は、その人の有効な権利だけ(ほかの人・返金した権利は印にならない)
// - 画像の口は、ログインと公開中かを確かめる。透かし付きのサムネイル・プレビューだけを返し、原本は決して返さない

const NOW = '2026-11-03T10:00:00+09:00';
const ME = 'U901:わたし';
const OTHER = 'U902:ほかの人';

async function enablePhotoSales() {
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', ?)").bind(NOW).run();
}

/** 中身で見分けられる小さなバイト列(本物の JPEG である必要はない。Worker はデコードしない) */
const bytes = (label: string) => new TextEncoder().encode(`${label}|${'x'.repeat(64)}`);

type PhotoSpec = { status?: 'draft' | 'published' | 'hidden' | 'removed'; priceOverride?: number | null; filesDeleted?: boolean; sort?: number };
type AlbumSpec = {
  name?: string;
  kind?: 'date' | 'event';
  eventDate?: string;
  status?: 'draft' | 'published' | 'ended';
  priceListId?: number;
  saleEndsAt?: string | null;
  removedAt?: string | null;
  endedAt?: string | null;
  cover?: number;
  photos?: PhotoSpec[];
};

let seq = 0;

/** アルバムと写真を DB と代わりの置き場所に直接入れる(段階1では 1-A の公開を待たずに準備する) */
async function seedAlbum(spec: AlbumSpec = {}): Promise<{ albumId: number; photoIds: number[] }> {
  const r = await env.DB.prepare(
    `INSERT INTO albums (name, kind, event_date, price_list_id, status, published_at, sale_ends_at, removed_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      spec.name ?? '2026/11/01',
      spec.kind ?? 'date',
      spec.eventDate ?? '2026-11-01',
      spec.priceListId ?? 1,
      spec.status ?? 'published',
      (spec.status ?? 'published') === 'draft' ? null : '2026-11-01T09:00:00+09:00',
      spec.saleEndsAt === undefined ? '2027-05-01T09:00:00+09:00' : spec.saleEndsAt,
      spec.removedAt ?? null,
      spec.endedAt ?? null,
      NOW,
      NOW,
    )
    .first<{ id: number }>();
  const albumId = r!.id;
  const photoIds: number[] = [];
  for (const [i, p] of (spec.photos ?? [{}]).entries()) {
    seq++;
    const keys = {
      original: `originals/o${seq}/o${seq}.jpg`,
      preview: `preview/p${seq}/p${seq}.jpg`,
      thumb: `thumb/t${seq}/t${seq}.jpg`,
      view: `view/v${seq}/v${seq}.jpg`,
    };
    for (const [kind, key] of Object.entries(keys)) {
      await env.MEDIA.put(`photo-sales/${key}`, bytes(`${kind}-${seq}`), { httpMetadata: { contentType: 'image/jpeg' } });
    }
    const ph = await env.DB.prepare(
      `INSERT INTO photos (original_key, preview_key, thumb_key, view_key, sha256, bytes, content_type, width, height, original_filename,
                           status, files_deleted_at, created_at, uploaded_at)
       VALUES (?, ?, ?, ?, ?, 100, 'image/jpeg', 1800, 1200, ?, 'ready', ?, ?, ?) RETURNING id`,
    )
      .bind(keys.original, keys.preview, keys.thumb, keys.view, 'a'.repeat(64), `IMG_${seq}.JPG`, p.filesDeleted ? NOW : null, NOW, NOW)
      .first<{ id: number }>();
    const status = p.status ?? 'published';
    await env.DB.prepare(
      `INSERT INTO album_photos (album_id, photo_id, sort_order, status, price_override, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(albumId, ph!.id, p.sort ?? i + 1, status, p.priceOverride ?? null, status === 'published' ? '2026-11-01T09:00:00+09:00' : null, NOW, NOW)
      .run();
    photoIds.push(ph!.id);
  }
  if (spec.cover !== undefined) await env.DB.prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').bind(photoIds[spec.cover], albumId).run();
  return { albumId, photoIds };
}

/** 購入の権利を直接入れる(1-C の Webhook を待たずに準備する) */
async function grant(user: string, albumId: number, photoId: number, revoked = false) {
  const [userId, displayName = ''] = user.split(':');
  const c = await ensurePhotoCustomer(env.DB, { userId: userId!, displayName }, new Date(NOW));
  const o = await env.DB.prepare(
    `INSERT INTO orders (customer_id, status, amount, payment_mode, paid_at, created_at, updated_at) VALUES (?, 'paid', 500, 'mock', ?, ?, ?) RETURNING id`,
  )
    .bind(c.id, NOW, NOW, NOW)
    .first<{ id: number }>();
  const oi = await env.DB.prepare(
    `INSERT INTO order_items (order_id, kind, album_id, photo_id, unit_price, label) VALUES (?, 'photo', ?, ?, 500, '写真') RETURNING id`,
  )
    .bind(o!.id, albumId, photoId)
    .first<{ id: number }>();
  await env.DB.prepare(
    `INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at, revoked_at, revoke_reason) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(c.id, photoId, oi!.id, NOW, revoked ? NOW : null, revoked ? '返金' : null)
    .run();
}

async function media(path: string, opts: { user?: string; now?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.user !== undefined) {
    const [id, name = ''] = opts.user.split(':');
    headers.authorization = `Bearer mock:${id}:${encodeURIComponent(name)}`;
  }
  headers['x-debug-now'] = opts.now ?? NOW;
  const res = await SELF.fetch(`${BASE}${path}`, { headers });
  // 画像も文字として比べる(見分けるための中身は文字で入れてある)
  return { res, text: new TextDecoder().decode(await res.arrayBuffer()) };
}

const albums = async (query = '', now = NOW) => {
  const r = await call<GalleryAlbumsResponse>(`/api/photos/albums${query}`, { user: ME, now });
  expect(r.status).toBe(200);
  return galleryAlbumsResponseSchema.parse(r.body);
};
const detail = (id: number, user = ME, now = NOW) => call<GalleryAlbumDetail & { error: { message: string } }>(`/api/photos/albums/${id}`, { user, now });

beforeEach(async () => {
  await enablePhotoSales();
});

describe('PU-2 アルバム一覧(GET /api/photos/albums)', () => {
  it('公開中・販売中のアルバムだけ。下書き・販売終了・一覧から外した・公開中の写真がないアルバムは出ない', async () => {
    const shown = await seedAlbum({ name: '見える', photos: [{}, {}, { status: 'hidden' }, { status: 'draft' }, { status: 'removed' }] });
    await seedAlbum({ name: '下書き', status: 'draft', saleEndsAt: null });
    await seedAlbum({ name: '販売終了', status: 'ended', endedAt: NOW });
    await seedAlbum({ name: '期限切れ', saleEndsAt: '2026-11-03T09:59:59+09:00' });
    await seedAlbum({ name: '外した', removedAt: NOW });
    await seedAlbum({ name: '写真なし', photos: [{ status: 'hidden' }, { status: 'draft' }] });
    await seedAlbum({ name: 'ファイルを消した', photos: [{ filesDeleted: true }] });
    const r = await albums();
    expect(r.albums.map((a) => a.name)).toEqual(['見える']);
    expect(r.albums[0]).toMatchObject({ id: shown.albumId, kind: 'date', eventDate: '2026-11-01', photoCount: 2, unitPrice: 500, albumPrice: null });
  });

  it('販売終了の日時になると、一覧から消える', async () => {
    await seedAlbum({ name: '今日まで', saleEndsAt: '2026-11-03T12:00:00+09:00' });
    expect((await albums('', '2026-11-03T11:59:00+09:00')).albums).toHaveLength(1);
    expect((await albums('', '2026-11-03T12:00:00+09:00')).albums).toHaveLength(0);
  });

  it('カバー写真は、決めた写真(公開中なら)。なければ最初の写真', async () => {
    const a = await seedAlbum({ name: 'カバーあり', cover: 1, photos: [{}, {}] });
    const b = await seedAlbum({ name: 'カバーが非公開', eventDate: '2026-10-31', cover: 0, photos: [{ status: 'hidden' }, { sort: 5 }, { sort: 2 }] });
    const r = await albums();
    expect(r.albums.find((x) => x.id === a.albumId)!.coverThumbUrl).toBe(`/api/photos/media/${a.albumId}/${a.photoIds[1]}/thumb`);
    expect(r.albums.find((x) => x.id === b.albumId)!.coverThumbUrl).toBe(`/api/photos/media/${b.albumId}/${b.photoIds[2]}/thumb`);
  });

  it('種類と年月で絞れる。月の一覧は新しい順(種類で絞ったあとの月)', async () => {
    await seedAlbum({ name: '11月の日付', kind: 'date', eventDate: '2026-11-01' });
    await seedAlbum({ name: '10月のイベント', kind: 'event', eventDate: '2026-10-12', priceListId: 2 });
    await seedAlbum({ name: '9月の日付', kind: 'date', eventDate: '2026-09-30' });
    const all = await albums();
    expect(all.albums.map((a) => a.name)).toEqual(['11月の日付', '10月のイベント', '9月の日付']);
    expect(all.months).toEqual(['2026-11', '2026-10', '2026-09']);
    const events = await albums('?kind=event');
    expect(events.albums.map((a) => a.name)).toEqual(['10月のイベント']);
    expect(events.albums[0]!.unitPrice).toBe(800);
    expect(events.months).toEqual(['2026-10']);
    const dates = await albums('?kind=date&month=2026-09');
    expect(dates.albums.map((a) => a.name)).toEqual(['9月の日付']);
    expect(dates.months).toEqual(['2026-11', '2026-09']);
  });

  it('絞り込みの値が正しくなければ 400(日本語の案内)', async () => {
    const r = await call('/api/photos/albums?month=2026-13', { user: ME, now: NOW });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/[ぁ-ん]/);
  });
});

describe('PU-3 アルバム詳細(GET /api/photos/albums/:id)', () => {
  it('公開中の写真だけを並び順に。価格は例外価格 > 価格表。画像は透かし付きの口の URL だけ', async () => {
    const a = await seedAlbum({
      photos: [{ sort: 3 }, { sort: 1, priceOverride: 1200 }, { status: 'hidden' }, { status: 'draft' }, { status: 'removed' }, { sort: 2, filesDeleted: true }],
    });
    const r = await detail(a.albumId);
    expect(r.status).toBe(200);
    const d = galleryAlbumDetailSchema.parse(r.body);
    expect(d.photos.map((p) => p.photoId)).toEqual([a.photoIds[1], a.photoIds[0]]);
    expect(d.photos.map((p) => p.price)).toEqual([1200, 500]);
    expect(d.photos[0]).toMatchObject({
      thumbUrl: `/api/photos/media/${a.albumId}/${a.photoIds[1]}/thumb`,
      previewUrl: `/api/photos/media/${a.albumId}/${a.photoIds[1]}/preview`,
      width: 1800,
      height: 1200,
      purchased: false,
    });
    expect(d.album.photoCount).toBe(2);
    // 置き場所のキー(原本・中サイズ・購入済み)は返さない
    expect(JSON.stringify(r.body)).not.toMatch(/originals\/|view\/|purchased\/|preview\/p|thumb\/t/);
  });

  it('下書き・販売終了・期限切れ・一覧から外した・ない番号は 404', async () => {
    const ids = [
      (await seedAlbum({ status: 'draft', saleEndsAt: null })).albumId,
      (await seedAlbum({ status: 'ended', endedAt: NOW })).albumId,
      (await seedAlbum({ saleEndsAt: '2026-11-02T00:00:00+09:00' })).albumId,
      (await seedAlbum({ removedAt: NOW })).albumId,
      9999,
    ];
    for (const id of ids) {
      const r = await detail(id);
      expect(r.status, String(id)).toBe(404);
      expect(r.body.error.message).toContain('写真の一覧から選び直してください');
    }
    for (const bad of ['0', 'abc', '1.5', '-1']) expect((await call(`/api/photos/albums/${bad}`, { user: ME, now: NOW })).status, bad).toBe(404);
  });

  it('購入済みの印は自分の有効な権利だけ。ほかの人の購入・返金した写真は印にならない', async () => {
    const a = await seedAlbum({ photos: [{}, {}, {}] });
    await grant(ME, a.albumId, a.photoIds[0]!);
    await grant(OTHER, a.albumId, a.photoIds[1]!);
    await grant(ME, a.albumId, a.photoIds[2]!, true);
    const mine = galleryAlbumDetailSchema.parse((await detail(a.albumId)).body);
    expect(mine.photos.map((p) => p.purchased)).toEqual([true, false, false]);
    const other = galleryAlbumDetailSchema.parse((await detail(a.albumId, OTHER)).body);
    expect(other.photos.map((p) => p.purchased)).toEqual([false, true, false]);
  });

  it('ほかのアルバムで買った同じ写真も購入済み(権利は写真ごと)', async () => {
    const a = await seedAlbum({ photos: [{}] });
    const b = await seedAlbum({ photos: [] });
    await env.DB.prepare(
      `INSERT INTO album_photos (album_id, photo_id, sort_order, status, published_at, created_at, updated_at) VALUES (?, ?, 1, 'published', ?, ?, ?)`,
    )
      .bind(b.albumId, a.photoIds[0], NOW, NOW, NOW)
      .run();
    await grant(ME, a.albumId, a.photoIds[0]!);
    const d = galleryAlbumDetailSchema.parse((await detail(b.albumId)).body);
    expect(d.photos[0]!.purchased).toBe(true);
  });

  it('まるごと購入: 価格表にまるごとの価格があり、まだ全部は持っていないときだけ', async () => {
    const pl = await env.DB.prepare(
      `INSERT INTO price_lists (name, unit_price, album_price, status, created_at, updated_at) VALUES ('まるごと', 500, 3000, 'active', ?, ?) RETURNING id`,
    )
      .bind(NOW, NOW)
      .first<{ id: number }>();
    const a = await seedAlbum({ priceListId: pl!.id, photos: [{}, {}] });
    let d = galleryAlbumDetailSchema.parse((await detail(a.albumId)).body);
    expect(d.album.albumPrice).toBe(3000);
    expect(d.canBuyAlbum).toBe(true);
    await grant(ME, a.albumId, a.photoIds[0]!);
    await grant(ME, a.albumId, a.photoIds[1]!);
    d = galleryAlbumDetailSchema.parse((await detail(a.albumId)).body);
    expect(d.canBuyAlbum).toBe(false);
    const noPrice = await seedAlbum({ photos: [{}] });
    expect(galleryAlbumDetailSchema.parse((await detail(noPrice.albumId)).body).canBuyAlbum).toBe(false);
  });

  it('開くと購入者(photo_customers)が記録される。会員でなくてよい', async () => {
    const a = await seedAlbum();
    expect((await detail(a.albumId, 'U903:ゲスト')).status).toBe(200);
    const row = await env.DB.prepare("SELECT display_name FROM photo_customers WHERE line_user_id = 'U903'").first<{ display_name: string }>();
    expect(row?.display_name).toBe('ゲスト');
  });
});

describe('PU-3・PU-4 画像の口(GET /api/photos/media/:albumId/:photoId/thumb・preview)', () => {
  it('サムネイルとプレビューは、それぞれのファイルをそのまま返す。誰でも開ける保存にはしない(private)', async () => {
    const a = await seedAlbum();
    const n = seq;
    const t = await media(`/api/photos/media/${a.albumId}/${a.photoIds[0]}/thumb`, { user: ME });
    expect(t.res.status).toBe(200);
    expect(t.text).toBe(new TextDecoder().decode(bytes(`thumb-${n}`)));
    expect(t.res.headers.get('content-type')).toBe('image/jpeg');
    expect(t.res.headers.get('cache-control')).toMatch(/^private/);
    expect(t.res.headers.get('x-content-type-options')).toBe('nosniff');
    const p = await media(`/api/photos/media/${a.albumId}/${a.photoIds[0]}/preview`, { user: ME });
    expect(p.res.status).toBe(200);
    expect(p.text).toBe(new TextDecoder().decode(bytes(`preview-${n}`)));
  });

  it('原本・中サイズは、どの口からも返らない(大きさや種類を選ぶ口がない)', async () => {
    const a = await seedAlbum();
    const n = seq;
    const base = `/api/photos/media/${a.albumId}/${a.photoIds[0]}`;
    const originalText = new TextDecoder().decode(bytes(`original-${n}`));
    const viewText = new TextDecoder().decode(bytes(`view-${n}`));
    for (const path of [
      `${base}/thumb`,
      `${base}/preview`,
      `${base}/original`,
      `${base}/view`,
      `${base}/purchased`,
      `${base}/thumb?size=original`,
      `${base}/preview?kind=original&watermark=0`,
      `${base}`,
    ]) {
      const r = await media(path, { user: ME });
      expect(r.text, path).not.toBe(originalText);
      expect(r.text, path).not.toBe(viewText);
      if (!path.endsWith('/thumb') && !path.endsWith('/preview') && !path.includes('?')) expect(r.res.status, path).toBe(404);
    }
  });

  it('ログインがなければ 401。販売が準備中なら 503', async () => {
    const a = await seedAlbum();
    const path = `/api/photos/media/${a.albumId}/${a.photoIds[0]}/thumb`;
    expect((await media(path)).res.status).toBe(401);
    expect((await media(path.replace('thumb', 'preview'))).res.status).toBe(401);
    await env.DB.prepare("UPDATE settings SET value = 'false' WHERE key = 'photo_sales_enabled'").run();
    const r = await media(path, { user: ME });
    expect(r.res.status).toBe(503);
    expect(JSON.parse(r.text).error.code).toBe('photo_sales_unavailable');
    expect((await call('/api/photos/albums', { user: ME })).status).toBe(503);
    expect((await call(`/api/photos/albums/${a.albumId}`, { user: ME })).status).toBe(503);
  });

  it('公開中でない写真・ほかのアルバムの写真・販売中でないアルバムの写真は 404', async () => {
    const a = await seedAlbum({ photos: [{}, { status: 'hidden' }, { status: 'draft' }, { status: 'removed' }, { filesDeleted: true }] });
    const other = await seedAlbum({ photos: [{}] });
    const draft = await seedAlbum({ status: 'draft', saleEndsAt: null, photos: [{ status: 'draft' }] });
    const ended = await seedAlbum({ saleEndsAt: '2026-11-01T00:00:00+09:00' });
    const removed = await seedAlbum({ removedAt: NOW });
    const cases: [number, number][] = [
      [a.albumId, a.photoIds[1]!],
      [a.albumId, a.photoIds[2]!],
      [a.albumId, a.photoIds[3]!],
      [a.albumId, a.photoIds[4]!],
      [a.albumId, other.photoIds[0]!],
      [draft.albumId, draft.photoIds[0]!],
      [ended.albumId, ended.photoIds[0]!],
      [removed.albumId, removed.photoIds[0]!],
    ];
    for (const [albumId, photoId] of cases) {
      for (const kind of ['thumb', 'preview']) {
        expect((await media(`/api/photos/media/${albumId}/${photoId}/${kind}`, { user: ME })).res.status, `${albumId}/${photoId}/${kind}`).toBe(404);
      }
    }
    expect((await media(`/api/photos/media/${a.albumId}/${a.photoIds[0]}/thumb`, { user: ME })).res.status).toBe(200);
  });

  it('同じ写真を確かめに来たとき(If-None-Match)は 304 で、本文を送らない', async () => {
    const a = await seedAlbum();
    const path = `/api/photos/media/${a.albumId}/${a.photoIds[0]}/thumb`;
    const first = await media(path, { user: ME });
    const etag = first.res.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{24}"$/);
    const again = await media(path, { user: ME, headers: { 'if-none-match': etag } });
    expect(again.res.status).toBe(304);
    expect(again.text).toBe('');
    // 304 でも、販売中でなくなった写真は 404(確かめてから答える)
    await env.DB.prepare("UPDATE album_photos SET status = 'hidden' WHERE photo_id = ?").bind(a.photoIds[0]).run();
    expect((await media(path, { user: ME, headers: { 'if-none-match': etag } })).res.status).toBe(404);
  });
});
