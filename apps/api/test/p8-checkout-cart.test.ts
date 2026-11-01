import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { call } from './helpers';
import { BUYER, NOW, OTHER, addItems, addToAlbum, buy, enablePhotoSales, getCart, seedAlbum, seedPhoto } from './p8-checkout-fixtures';

// PU-5 カート(docs/photo-requirements.md 3.9)。サーバー側のカート・複数・重なり・まるごとに含まれる・買えなくなった行・合計

beforeEach(enablePhotoSales);

describe('カートに入れる(複数をまとめて)', () => {
  it('同じアルバムの何枚でも、別のアルバムの写真も、まるごとも混ぜて入れられる。合計はサーバーが計算する', async () => {
    const a = await seedAlbum({ unitPrice: 500, photos: 3 });
    const b = await seedAlbum({ unitPrice: 800, albumPrice: 3000, photos: 4 });
    const c = await seedAlbum({ unitPrice: 600, photos: 2 });
    const r = await addItems([
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! },
      { kind: 'photo', albumId: c.albumId, photoId: c.photoIds[0]! },
      { kind: 'album', albumId: b.albumId },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.added).toBe(4);
    expect(r.body.skipped).toEqual([]);
    expect(r.body.items.map((i: any) => i.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(r.body.total).toBe(500 + 500 + 600 + 3000);
    expect(r.body.payableCount).toBe(4);
    const album = r.body.items.find((i: any) => i.kind === 'album');
    expect(album).toMatchObject({ photoCount: 4, unitPrice: 3000, label: 'アルバムまるごと(4枚)', photoId: null });
    expect(album.thumbUrl).toBe(`/api/photos/media/${b.albumId}/${b.photoIds[0]}/thumb`);
  });

  it('画面から送った金額は使わない(写真ごとの例外価格は DB から)', async () => {
    const a = await seedAlbum({ unitPrice: 500, photos: 1 });
    const p = (await seedAlbum({ photos: 0 })).albumId;
    const ph = await seedPhoto();
    await addToAlbum(p, ph.photoId, { priceOverride: 1200 });
    const r = await call('/api/photos/cart/items', {
      user: BUYER,
      now: NOW,
      body: { items: [{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0], unitPrice: 1 }, { kind: 'photo', albumId: p, photoId: ph.photoId, price: 1 }], total: 2 },
    });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: any) => i.unitPrice)).toEqual([500, 1200]);
    expect(r.body.total).toBe(1700);
  });

  it('同じ写真は1つだけ(同じ送信の中でも、あとからでも、ほかのアルバムからでも)。同じまるごとも1つだけ', async () => {
    const a = await seedAlbum({ albumPrice: 2000, photos: 2 });
    const b = await seedAlbum({ photos: 0 });
    await addToAlbum(b.albumId, a.photoIds[0]!);
    const first = await addItems([
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'album', albumId: a.albumId },
      { kind: 'album', albumId: a.albumId },
    ]);
    expect(first.body.added).toBe(2);
    const again = await addItems([
      { kind: 'photo', albumId: b.albumId, photoId: a.photoIds[0]! },
      { kind: 'album', albumId: a.albumId },
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! },
    ]);
    expect(again.status).toBe(200);
    expect(again.body.added).toBe(1);
    expect(again.body.skipped).toEqual([
      { item: { kind: 'photo', albumId: b.albumId, photoId: a.photoIds[0] }, reason: 'already_in_cart', message: 'すでにカートにあります' },
      { item: { kind: 'album', albumId: a.albumId }, reason: 'already_in_cart', message: 'すでにカートにあります' },
    ]);
    expect(again.body.items).toHaveLength(3);
  });

  it('まるごとに含まれる1枚の行は「含まれています」の印で、請求しない', async () => {
    const a = await seedAlbum({ unitPrice: 500, albumPrice: 1200, photos: 3 });
    const other = await seedAlbum({ unitPrice: 700, photos: 1 });
    const r = await addItems([
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'photo', albumId: other.albumId, photoId: other.photoIds[0]! },
      { kind: 'album', albumId: a.albumId },
    ]);
    const [single, otherLine, album] = r.body.items;
    expect(single).toMatchObject({ state: 'redundant', reason: 'in_album', message: 'アルバムまるごとに含まれています' });
    expect(otherLine.state).toBe('ok');
    expect(album.state).toBe('ok');
    expect(r.body.total).toBe(1200 + 700);
    expect(r.body.payableCount).toBe(2);
  });

  it('ほかのアルバムから入れた同じ写真も、まるごとに含まれていれば請求しない', async () => {
    const a = await seedAlbum({ albumPrice: 1500, photos: 2 });
    const b = await seedAlbum({ unitPrice: 900, photos: 0 });
    await addToAlbum(b.albumId, a.photoIds[1]!);
    const r = await addItems([
      { kind: 'photo', albumId: b.albumId, photoId: a.photoIds[1]! },
      { kind: 'album', albumId: a.albumId },
    ]);
    expect(r.body.items[0].state).toBe('redundant');
    expect(r.body.total).toBe(1500);
  });

  it('買えないものは入れず、理由を返す(販売終了・下書き・非公開・外した・購入済み・まるごとの価格なし)', async () => {
    const ended = await seedAlbum({ saleEndsAt: '2026-11-02T00:00:00+09:00', photos: 1 });
    const draft = await seedAlbum({ status: 'draft', photos: 1 });
    const open = await seedAlbum({ photos: 3 });
    await env.DB.prepare("UPDATE album_photos SET status = 'hidden' WHERE photo_id = ?").bind(open.photoIds[1]).run();
    await env.DB.prepare("UPDATE album_photos SET status = 'removed' WHERE photo_id = ?").bind(open.photoIds[2]).run();
    const owned = await seedAlbum({ photos: 1 });
    await buy([{ kind: 'photo', albumId: owned.albumId, photoId: owned.photoIds[0]! }]);
    const r = await addItems([
      { kind: 'photo', albumId: ended.albumId, photoId: ended.photoIds[0]! },
      { kind: 'photo', albumId: draft.albumId, photoId: draft.photoIds[0]! },
      { kind: 'photo', albumId: open.albumId, photoId: open.photoIds[1]! },
      { kind: 'photo', albumId: open.albumId, photoId: open.photoIds[2]! },
      { kind: 'photo', albumId: owned.albumId, photoId: owned.photoIds[0]! },
      { kind: 'album', albumId: open.albumId },
      { kind: 'photo', albumId: 9999, photoId: 99999 },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.added).toBe(0);
    expect(r.body.skipped.map((s: any) => s.reason)).toEqual(['ended', 'hidden', 'hidden', 'not_found', 'already_owned', 'no_album_price', 'not_found']);
    expect(r.body.items).toEqual([]);
  });

  it('入れたあとで買えなくなった行は、印と理由を付けて見せ、合計から除く', async () => {
    const a = await seedAlbum({ unitPrice: 500, photos: 2 });
    const b = await seedAlbum({ unitPrice: 800, albumPrice: 2000, photos: 2 });
    await addItems([
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! },
      { kind: 'album', albumId: b.albumId },
    ]);
    await env.DB.prepare('UPDATE albums SET sale_ends_at = ? WHERE id = ?').bind('2026-11-03T09:00:00+09:00', a.albumId).run();
    await env.DB.prepare('UPDATE price_lists SET album_price = NULL WHERE id = (SELECT price_list_id FROM albums WHERE id = ?)').bind(b.albumId).run();
    const r = await getCart();
    expect(r.body.items.map((i: any) => [i.state, i.reason])).toEqual([
      ['unavailable', 'ended'],
      ['unavailable', 'ended'],
      ['unavailable', 'no_album_price'],
    ]);
    expect(r.body.items[0].message).toBe('販売が終わりました');
    expect(r.body.total).toBe(0);
    expect(r.body.payableCount).toBe(0);
  });

  it('まるごとが買えなくなったら、含まれていた1枚の行は請求の対象に戻る', async () => {
    const a = await seedAlbum({ unitPrice: 500, albumPrice: 1200, photos: 2 });
    await addItems([
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'album', albumId: a.albumId },
    ]);
    await env.DB.prepare('UPDATE price_lists SET album_price = NULL WHERE id = ?').bind(a.priceListId).run();
    const r = await getCart();
    expect(r.body.items.map((i: any) => i.state)).toEqual(['ok', 'unavailable']);
    expect(r.body.total).toBe(500);
  });

  it('1回に入れられるのは200件まで', async () => {
    const r = await addItems(Array.from({ length: 201 }, (_, i) => ({ kind: 'photo' as const, albumId: 1, photoId: i + 1 })));
    expect(r.status).toBe(400);
  });
});

describe('カートを見る・外す', () => {
  it('サーバーに残る(開き直しても、別の端末でも同じ)。1行ずつ外せる。行は消さない', async () => {
    const a = await seedAlbum({ photos: 3 });
    await addItems(a.photoIds.map((photoId) => ({ kind: 'photo' as const, albumId: a.albumId, photoId })));
    const first = await getCart();
    expect(first.body.items).toHaveLength(3);
    const del = await call(`/api/photos/cart/items/${first.body.items[1].id}`, { user: BUYER, method: 'DELETE', now: NOW });
    expect(del.status).toBe(200);
    expect(del.body.items.map((i: any) => i.photoId)).toEqual([a.photoIds[0], a.photoIds[2]]);
    expect(del.body.total).toBe(1000);
    const again = await getCart();
    expect(again.body).toEqual(del.body);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n, COUNT(removed_at) AS removed FROM cart_items').first<{ n: number; removed: number }>();
    expect(rows).toEqual({ n: 3, removed: 1 });
    // 外したあと、もう一度入れられる
    const re = await addItems([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[1]! }]);
    expect(re.body.added).toBe(1);
  });

  it('ほかの人のカートは見えない・外せない(404)', async () => {
    const a = await seedAlbum({ photos: 2 });
    await addItems([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }], OTHER);
    const theirs = await getCart(OTHER);
    expect((await getCart()).body.items).toEqual([]);
    const del = await call(`/api/photos/cart/items/${theirs.body.items[0].id}`, { user: BUYER, method: 'DELETE', now: NOW });
    expect(del.status).toBe(404);
    expect((await getCart(OTHER)).body.items).toHaveLength(1);
  });

  it('同じ行を2回外すと 404。番号でないものも 404', async () => {
    const a = await seedAlbum({ photos: 1 });
    const r = await addItems([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
    const id = r.body.items[0].id;
    expect((await call(`/api/photos/cart/items/${id}`, { user: BUYER, method: 'DELETE' })).status).toBe(200);
    expect((await call(`/api/photos/cart/items/${id}`, { user: BUYER, method: 'DELETE' })).status).toBe(404);
    expect((await call('/api/photos/cart/items/abc', { user: BUYER, method: 'DELETE' })).status).toBe(404);
  });
});
