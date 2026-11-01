import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOW, adminCall, insertAlbum, insertPhoto, insertSale, lastAudit, staffCookies, undo } from './p8-admin-helpers';

// 段階1-A(管理)。PA-3 アルバム一覧・PA-4 アルバム編集・PF-1・PF-4(docs/photo-requirements.md 6.2)

let admin: string;
let staff: string;
let developer: string;
beforeEach(async () => {
  ({ admin, staff, developer } = await staffCookies());
});

const albumPhotoStatus = async (albumId: number, photoId: number) =>
  (await env.DB.prepare('SELECT status FROM album_photos WHERE album_id = ? AND photo_id = ?').bind(albumId, photoId).first<{ status: string }>())?.status;

describe('アルバムを作る', () => {
  it('価格表を省くと、種類ごとの既定(日付 = 通常、イベント = イベント)。操作ログに残る', async () => {
    const d = await adminCall('/admin/api/photos/albums', { cookie: admin, now: NOW, body: { name: '11/3', kind: 'date', eventDate: '2026-11-03' } });
    expect(d.status).toBe(201);
    expect(d.body.album).toMatchObject({ name: '11/3', kind: 'date', status: 'draft', priceListId: 1, priceListName: '通常', counts: { draft: 0, published: 0, hidden: 0 } });
    const e = await adminCall('/admin/api/photos/albums', { cookie: admin, now: NOW, body: { name: '運動会', kind: 'event', eventDate: '2026-11-03' } });
    expect(e.body.album).toMatchObject({ priceListId: 2, priceListName: 'イベント' });
    const log = await lastAudit('photo_album.create');
    expect(log).toMatchObject({ target_type: 'photo_album', target_id: String(e.body.album.id), actor_type: 'staff' });
  });

  it('入力が正しくなければ 400 と日本語の案内', async () => {
    const r = await adminCall('/admin/api/photos/albums', { cookie: admin, body: { name: '', kind: 'date', eventDate: '2026-11-03' } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('アルバムの名前を入れてください。');
  });

  it('フォルダの名前から: 日付とイベントを分け、いくつも作る。同じフォルダの下書きがあればそれを使う', async () => {
    const r = await adminCall('/admin/api/photos/albums/from-folders', {
      cookie: admin,
      now: NOW,
      body: { folders: ['2026-11-01', '20261102', '秋の運動会', '2026.11.01'] },
    });
    expect(r.status).toBe(200);
    const [a, b, c, d] = r.body.albums;
    expect(a).toMatchObject({ folder: '2026-11-01', name: '2026/11/01', kind: 'date', eventDate: '2026-11-01', created: true });
    expect(b).toMatchObject({ name: '2026/11/02', kind: 'date', eventDate: '2026-11-02', created: true });
    expect(c).toMatchObject({ name: '秋の運動会', kind: 'event', eventDate: '2026-11-03', created: true });
    // 同じ日付の別の書き方は、同じアルバム
    expect(d).toMatchObject({ albumId: a.albumId, created: false });
    const again = await adminCall('/admin/api/photos/albums/from-folders', { cookie: admin, now: NOW, body: { folders: ['秋の運動会'] } });
    expect(again.body.albums[0]).toMatchObject({ albumId: c.albumId, created: false });
    const source = await env.DB.prepare('SELECT source_folder, price_list_id FROM albums WHERE id = ?').bind(c.albumId).first<any>();
    expect(source).toEqual({ source_folder: '秋の運動会', price_list_id: 2 });
  });
});

describe('一覧と内容', () => {
  it('状態・枚数・売上・販売終了日。外したアルバムは出さない。絞り込み', async () => {
    const a = await insertAlbum({ name: '2026/11/02', status: 'published', publishedAt: NOW, saleEndsAt: '2027-05-03T10:00:00+09:00' });
    const p1 = await insertPhoto(a, { status: 'published' });
    await insertPhoto(a, { status: 'published' });
    await insertPhoto(a, { status: 'hidden' });
    await insertPhoto(a, { status: 'draft' });
    await insertSale(a, p1, 500);
    const b = await insertAlbum({ name: '運動会', kind: 'event' });
    await env.DB.prepare('UPDATE albums SET removed_at = ? WHERE id = ?').bind(NOW, await insertAlbum({ name: '外した' })).run();
    const r = await adminCall('/admin/api/photos/albums', { cookie: admin });
    expect(r.status).toBe(200);
    expect(r.body.albums.map((x: any) => x.name).sort()).toEqual(['2026/11/02', '運動会']);
    const row = r.body.albums.find((x: any) => x.id === a);
    expect(row).toMatchObject({
      status: 'published',
      counts: { draft: 1, published: 2, hidden: 1 },
      salesYen: 500,
      soldPhotos: 1,
      saleEndsAt: '2027-05-03T10:00:00+09:00',
      coverThumbUrl: `/admin/api/photos/photos/${p1}/thumb`,
    });
    const ev = await adminCall('/admin/api/photos/albums?kind=event', { cookie: admin });
    expect(ev.body.albums.map((x: any) => x.id)).toEqual([b]);
    const q = await adminCall(`/admin/api/photos/albums?q=${encodeURIComponent('運動')}`, { cookie: admin });
    expect(q.body.albums.map((x: any) => x.id)).toEqual([b]);
    const st = await adminCall('/admin/api/photos/albums?status=published', { cookie: admin, now: NOW });
    expect(st.body.albums.map((x: any) => x.id)).toEqual([a]);
  });

  it('内容: 写真の価格(例外 > 価格表)・売れたか・ほかのアルバムにも載っているか', async () => {
    const a = await insertAlbum();
    const b = await insertAlbum({ name: '運動会', kind: 'event', priceListId: 2 });
    const p1 = await insertPhoto(a, { filename: 'IMG_0001.JPG' });
    const p2 = await insertPhoto(a, { filename: 'IMG_0002.JPG' });
    await env.DB.prepare('UPDATE album_photos SET price_override = 1200 WHERE photo_id = ?').bind(p2).run();
    await env.DB.prepare("INSERT INTO album_photos (album_id, photo_id, sort_order, status, created_at, updated_at) VALUES (?, ?, 1, 'draft', ?, ?)").bind(b, p1, NOW, NOW).run();
    await insertSale(a, p1);
    const r = await adminCall(`/admin/api/photos/albums/${a}`, { cookie: developer });
    expect(r.status).toBe(200);
    expect(r.body.album).toMatchObject({ id: a, unitPrice: 500, albumPrice: null });
    expect(r.body.photos).toHaveLength(2);
    expect(r.body.photos[0]).toMatchObject({ photoId: p1, price: 500, priceOverride: null, sold: true, alsoIn: [{ albumId: b, name: '運動会' }], thumbUrl: `/admin/api/photos/photos/${p1}/thumb` });
    expect(r.body.photos[1]).toMatchObject({ photoId: p2, price: 1200, priceOverride: 1200, sold: false, alsoIn: [] });
    expect((await adminCall('/admin/api/photos/albums/99999', { cookie: admin })).status).toBe(404);
  });

  it('管理画面の写真(サムネイル・プレビュー)はログインした管理者に、Worker から出す', async () => {
    const a = await insertAlbum();
    const p = await insertPhoto(a);
    const res = await adminCall(`/admin/api/photos/photos/${p}/thumb`, { cookie: admin });
    expect(res.status).toBe(200);
    expect((await adminCall(`/admin/api/photos/photos/${p}/preview`, { cookie: developer })).status).toBe(200);
    expect((await adminCall(`/admin/api/photos/photos/${p}/thumb`, { cookie: staff })).status).toBe(403);
    expect((await adminCall(`/admin/api/photos/photos/${p}/thumb`)).status).toBe(401);
    expect((await adminCall('/admin/api/photos/photos/99999/thumb', { cookie: admin })).status).toBe(404);
  });
});

describe('変える', () => {
  it('名前・価格表・販売期間の延長。操作ログから元に戻せる', async () => {
    const a = await insertAlbum({ status: 'published', publishedAt: NOW, saleEndsAt: '2027-05-03T10:00:00+09:00' });
    await insertPhoto(a, { status: 'published' });
    const r = await adminCall(`/admin/api/photos/albums/${a}`, {
      cookie: admin,
      method: 'PATCH',
      now: NOW,
      body: { name: '11月2日', priceListId: 2, saleEndsAt: '2027-08-31T23:59:00+09:00' },
    });
    expect(r.status).toBe(200);
    expect(r.body.album).toMatchObject({ name: '11月2日', priceListId: 2, saleEndsAt: '2027-08-31T23:59:00+09:00', unitPrice: 800 });
    expect(r.body.photos[0].price).toBe(800);
    const log = await lastAudit('photo_album.update');
    expect(JSON.parse(log.before_value)).toMatchObject({ name: '2026/11/02', priceListId: 1 });
    expect((await undo(admin, log.id)).status).toBe(200);
    const back = await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin });
    expect(back.body.album).toMatchObject({ name: '2026/11/02', priceListId: 1, saleEndsAt: '2027-05-03T10:00:00+09:00' });
  });

  it('販売終了のアルバムを延ばすと、販売中に戻る(ファイルを消したあとは延ばせない)', async () => {
    const a = await insertAlbum({ status: 'ended', publishedAt: '2026-05-01T10:00:00+09:00', saleEndsAt: '2026-11-01T10:00:00+09:00' });
    const r = await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin, method: 'PATCH', now: NOW, body: { saleEndsAt: '2026-12-31T23:59:00+09:00' } });
    expect(r.body.album.status).toBe('published');
    const b = await insertAlbum({ status: 'ended', publishedAt: '2026-05-01T10:00:00+09:00', saleEndsAt: '2026-11-01T10:00:00+09:00' });
    await env.DB.prepare('UPDATE albums SET files_deleted_at = ? WHERE id = ?').bind(NOW, b).run();
    const x = await adminCall(`/admin/api/photos/albums/${b}`, { cookie: admin, method: 'PATCH', now: NOW, body: { saleEndsAt: '2026-12-31T23:59:00+09:00' } });
    expect(x.status).toBe(409);
  });

  it('使わないにした価格表は、新しく選べない', async () => {
    await env.DB.prepare("INSERT INTO price_lists (id, name, unit_price, status, created_at, updated_at) VALUES (3, '古い', 300, 'archived', ?, ?)").bind(NOW, NOW).run();
    const a = await insertAlbum();
    const r = await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin, method: 'PATCH', body: { priceListId: 3 } });
    expect(r.status).toBe(400);
  });
});

describe('公開(PF-4)', () => {
  it('下書きの写真を公開し、公開日時と販売終了の既定(公開 + 6か月)を入れる。2回目の公開で販売終了は変わらない', async () => {
    const a = await insertAlbum();
    const p1 = await insertPhoto(a);
    const p2 = await insertPhoto(a, { status: 'hidden' });
    const r = await adminCall(`/admin/api/photos/albums/${a}/publish`, { cookie: admin, now: '2026-08-31T10:00:00+09:00', body: {} });
    expect(r.status).toBe(200);
    expect(r.body.album).toMatchObject({ status: 'published', publishedAt: '2026-08-31T10:00:00+09:00', saleEndsAt: '2027-02-28T10:00:00+09:00' });
    expect(await albumPhotoStatus(a, p1)).toBe('published');
    expect(await albumPhotoStatus(a, p2)).toBe('hidden');
    const ap = await env.DB.prepare('SELECT published_at FROM album_photos WHERE photo_id = ?').bind(p1).first<any>();
    expect(ap.published_at).toBe('2026-08-31T10:00:00+09:00');
    // 足した写真をあとで公開しても、最初の公開日時・販売終了はそのまま
    const p3 = await insertPhoto(a);
    const again = await adminCall(`/admin/api/photos/albums/${a}/publish`, { cookie: admin, now: '2026-09-10T10:00:00+09:00', body: {} });
    expect(again.body.album).toMatchObject({ publishedAt: '2026-08-31T10:00:00+09:00', saleEndsAt: '2027-02-28T10:00:00+09:00' });
    expect(await albumPhotoStatus(a, p3)).toBe('published');
  });

  it('販売期間の設定(photo_sale_months)に従う', async () => {
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_sale_months', '3', ?)").bind(NOW).run();
    const a = await insertAlbum();
    await insertPhoto(a);
    const r = await adminCall(`/admin/api/photos/albums/${a}/publish`, { cookie: admin, now: NOW, body: {} });
    expect(r.body.album.saleEndsAt).toBe('2027-02-03T10:00:00+09:00');
  });

  it('写真がなければ公開できない(409)', async () => {
    const a = await insertAlbum();
    const r = await adminCall(`/admin/api/photos/albums/${a}/publish`, { cookie: admin, body: {} });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('写真をアップロード');
  });

  it('まとめて公開: 公開できないものは理由。操作ログから元に戻せる(下書きに戻る)', async () => {
    const a = await insertAlbum();
    const b = await insertAlbum({ name: '空' });
    const p = await insertPhoto(a);
    const r = await adminCall('/admin/api/photos/albums/publish', { cookie: admin, now: NOW, body: { albumIds: [a, b, 9999] } });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(1);
    expect(r.body.skipped.map((s: any) => s.photoId).sort()).toEqual([b, 9999]);
    expect(r.body.auditId).toEqual(expect.any(Number));
    expect(await albumPhotoStatus(a, p)).toBe('published');
    expect((await undo(admin, r.body.auditId)).status).toBe(200);
    const back = await env.DB.prepare('SELECT status, published_at, sale_ends_at FROM albums WHERE id = ?').bind(a).first<any>();
    expect(back).toEqual({ status: 'draft', published_at: null, sale_ends_at: null });
    expect(await albumPhotoStatus(a, p)).toBe('draft');
  });

  it('公開のあとに注文が入ったら、公開は取り消せない', async () => {
    const a = await insertAlbum();
    const p = await insertPhoto(a);
    const r = await adminCall('/admin/api/photos/albums/publish', { cookie: admin, now: NOW, body: { albumIds: [a] } });
    await insertSale(a, p);
    const u = await undo(admin, r.body.auditId);
    expect(u.status).toBe(409);
  });
});

describe('一覧から外す・戻す', () => {
  it('外す(行は残す)・戻す。売れた写真があれば外せない', async () => {
    const a = await insertAlbum();
    const r = await adminCall(`/admin/api/photos/albums/${a}/remove`, { cookie: admin, now: NOW, body: {} });
    expect(r.status).toBe(200);
    expect((await env.DB.prepare('SELECT removed_at FROM albums WHERE id = ?').bind(a).first<any>()).removed_at).toBe(NOW);
    expect((await adminCall('/admin/api/photos/albums', { cookie: admin })).body.albums).toHaveLength(0);
    expect((await adminCall(`/admin/api/photos/albums/${a}/restore`, { cookie: admin, body: {} })).status).toBe(200);
    expect((await adminCall('/admin/api/photos/albums', { cookie: admin })).body.albums).toHaveLength(1);
    const p = await insertPhoto(a);
    await insertSale(a, p);
    const x = await adminCall(`/admin/api/photos/albums/${a}/remove`, { cookie: admin, body: {} });
    expect(x.status).toBe(409);
    expect(x.body.error.code).toBe('photo_sold');
  });

  it('外したことは、操作ログから元に戻せる', async () => {
    const a = await insertAlbum();
    await adminCall(`/admin/api/photos/albums/${a}/remove`, { cookie: admin, now: NOW, body: {} });
    const log = await lastAudit('photo_album.remove');
    expect((await undo(admin, log.id)).status).toBe(200);
    expect((await env.DB.prepare('SELECT removed_at FROM albums WHERE id = ?').bind(a).first<any>()).removed_at).toBeNull();
  });
});

describe('写真の一括操作', () => {
  it('価格を変える・価格表に戻す。元に戻せる', async () => {
    const a = await insertAlbum();
    const p1 = await insertPhoto(a);
    const p2 = await insertPhoto(a);
    const r = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, now: NOW, body: { action: 'set_price', photoIds: [p1, p2], price: 1000 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ changed: 2, skipped: [] });
    const d = await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin });
    expect(d.body.photos.map((p: any) => p.price)).toEqual([1000, 1000]);
    const reset = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'reset_price', photoIds: [p1] } });
    expect(reset.body.changed).toBe(1);
    expect((await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin })).body.photos.map((p: any) => p.price)).toEqual([500, 1000]);
    // 価格を戻したことを元に戻す → 1000 円に
    expect((await undo(admin, reset.body.auditId)).status).toBe(200);
    expect((await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin })).body.photos.map((p: any) => p.price)).toEqual([1000, 1000]);
    // 最初の変更は、そのあとに変わっていないので戻せる
    expect((await undo(admin, r.body.auditId)).status).toBe(200);
    expect((await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin })).body.photos.map((p: any) => p.price)).toEqual([500, 500]);
  });

  it('50円より安い価格は 400', async () => {
    const a = await insertAlbum();
    const p = await insertPhoto(a);
    const r = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'set_price', photoIds: [p], price: 10 } });
    expect(r.status).toBe(400);
  });

  it('非公開・公開', async () => {
    const a = await insertAlbum();
    const p = await insertPhoto(a, { status: 'published' });
    await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'hide', photoIds: [p] } });
    expect(await albumPhotoStatus(a, p)).toBe('hidden');
    await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'publish', photoIds: [p] } });
    expect(await albumPhotoStatus(a, p)).toBe('published');
  });

  it('外す: 売れた写真は外せず非公開になり、理由が返る。行は消えない。元に戻せる', async () => {
    const a = await insertAlbum({ status: 'published', publishedAt: NOW });
    const sold = await insertPhoto(a, { status: 'published' });
    const free = await insertPhoto(a, { status: 'published' });
    await insertSale(a, sold);
    const r = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, now: NOW, body: { action: 'remove', photoIds: [sold, free] } });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(2);
    expect(r.body.skipped).toEqual([{ photoId: sold, reason: '購入された写真なので、外さずに非公開にしました。' }]);
    expect(await albumPhotoStatus(a, sold)).toBe('hidden');
    expect(await albumPhotoStatus(a, free)).toBe('removed');
    const d = await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin });
    expect(d.body.photos.map((p: any) => p.photoId)).toEqual([sold]);
    expect((await undo(admin, r.body.auditId)).status).toBe(200);
    expect(await albumPhotoStatus(a, sold)).toBe('published');
    expect(await albumPhotoStatus(a, free)).toBe('published');
  });

  it('移す・コピー: 同じ写真の行を共有する(原本は1つ)。売れた写真は移せない。移す先では下書き', async () => {
    const a = await insertAlbum();
    const b = await insertAlbum({ name: '運動会', kind: 'event', priceListId: 2 });
    const p1 = await insertPhoto(a, { status: 'published' });
    const p2 = await insertPhoto(a, { status: 'published' });
    const p3 = await insertPhoto(a, { status: 'published' });
    await insertSale(a, p3);
    const photosBefore = (await env.DB.prepare('SELECT COUNT(*) AS n FROM photos').first<any>()).n;
    const cp = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'copy', photoIds: [p1, p3], targetAlbumId: b } });
    expect(cp.body).toMatchObject({ changed: 2, skipped: [] });
    expect(await albumPhotoStatus(b, p1)).toBe('draft');
    expect(await albumPhotoStatus(b, p3)).toBe('draft');
    expect(await albumPhotoStatus(a, p1)).toBe('published');
    const mv = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'move', photoIds: [p2, p3, p1], targetAlbumId: b } });
    expect(mv.body.skipped).toEqual([
      { photoId: p3, reason: '購入された写真は移せません。「コピー」なら、ほかのアルバムにも載せられます。' },
      { photoId: p1, reason: 'もう、そのアルバムに載っています。' },
    ]);
    expect(await albumPhotoStatus(b, p2)).toBe('draft');
    expect(await albumPhotoStatus(a, p2)).toBe('removed');
    expect(await albumPhotoStatus(a, p1)).toBe('removed');
    expect(await albumPhotoStatus(a, p3)).toBe('published');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM photos').first<any>()).n).toBe(photosBefore);
    // 移す先のアルバムの価格表で値段が決まる
    const db = await adminCall(`/admin/api/photos/albums/${b}`, { cookie: admin });
    expect(db.body.photos.map((p: any) => p.price)).toEqual([800, 800, 800]);
    // 移したことを元に戻すと、移す先の掲載は「外した」になり、元のアルバムに戻る
    expect((await undo(admin, mv.body.auditId)).status).toBe(200);
    expect(await albumPhotoStatus(b, p2)).toBe('removed');
    expect(await albumPhotoStatus(a, p2)).toBe('published');
    expect(await albumPhotoStatus(a, p1)).toBe('published');
  });

  it('同じアルバムへは移せない。載っていない写真は skipped', async () => {
    const a = await insertAlbum();
    const p = await insertPhoto(a);
    const same = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'move', photoIds: [p], targetAlbumId: a } });
    expect(same.status).toBe(400);
    const r = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'hide', photoIds: [p, 9999] } });
    expect(r.body.skipped).toEqual([{ photoId: 9999, reason: 'このアルバムに載っていない写真です。' }]);
  });

  it('並び順', async () => {
    const a = await insertAlbum();
    const p1 = await insertPhoto(a);
    const p2 = await insertPhoto(a);
    const p3 = await insertPhoto(a);
    await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'reorder', photoIds: [p3, p1] } });
    const d = await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin });
    expect(d.body.photos.map((p: any) => p.photoId)).toEqual([p3, p1, p2]);
  });

  it('1000枚でも1回で変えられる(文の数が写真の数で増えない)', async () => {
    const a = await insertAlbum();
    const ids: number[] = [];
    const nowIso = NOW;
    // まとめて入れる
    for (let i = 0; i < 300; i++) {
      const r = await env.DB.prepare(
        `INSERT INTO photos (original_key, sha256, bytes, content_type, original_filename, status, created_at) VALUES (?, ?, 1, 'image/jpeg', ?, 'ready', ?)`,
      )
        .bind(`originals/bulk/${i}.jpg`, 'a'.repeat(64), `B_${i}.JPG`, nowIso)
        .run();
      ids.push(r.meta.last_row_id);
    }
    await env.DB.prepare(
      `INSERT INTO album_photos (album_id, photo_id, sort_order, status, created_at, updated_at)
       SELECT ?, value, key + 1, 'draft', ?, ? FROM json_each(?)`,
    )
      .bind(a, nowIso, nowIso, JSON.stringify(ids))
      .run();
    const r = await adminCall(`/admin/api/photos/albums/${a}/photos/bulk`, { cookie: admin, body: { action: 'set_price', photoIds: ids, price: 700 } });
    expect(r.body.changed).toBe(300);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM album_photos WHERE album_id = ? AND price_override = 700').bind(a).first<any>();
    expect(n.n).toBe(300);
  });
});

describe('権限', () => {
  it('受付は 403、製作者は変更が 403(見るのはできる)', async () => {
    const a = await insertAlbum();
    const p = await insertPhoto(a);
    expect((await adminCall('/admin/api/photos/albums', { cookie: staff })).status).toBe(403);
    expect((await adminCall('/admin/api/photos/albums', { cookie: developer })).status).toBe(200);
    for (const [method, path, body] of [
      ['POST', '/admin/api/photos/albums', { name: 'x', kind: 'date', eventDate: '2026-11-03' }],
      ['POST', '/admin/api/photos/albums/from-folders', { folders: ['2026-11-03'] }],
      ['POST', '/admin/api/photos/albums/publish', { albumIds: [a] }],
      ['PATCH', `/admin/api/photos/albums/${a}`, { name: 'y' }],
      ['POST', `/admin/api/photos/albums/${a}/publish`, {}],
      ['POST', `/admin/api/photos/albums/${a}/remove`, {}],
      ['POST', `/admin/api/photos/albums/${a}/photos/bulk`, { action: 'hide', photoIds: [p] }],
    ] as const) {
      expect((await adminCall(path, { cookie: developer, method, body })).status, `${method} ${path}`).toBe(403);
      expect((await adminCall(path, { cookie: staff, method, body })).status, `${method} ${path}`).toBe(403);
    }
    // 何も変わっていない
    expect(await albumPhotoStatus(a, p)).toBe('draft');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM albums').first<any>()).n).toBe(1);
  });
});
