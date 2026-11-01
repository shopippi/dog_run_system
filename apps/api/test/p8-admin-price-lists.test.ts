import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOW, adminCall, insertAlbum, insertPhoto, insertSale, lastAudit, staffCookies, undo } from './p8-admin-helpers';

// 段階1-A(管理)。PA-5 価格表(PF-3)

let admin: string;
let staff: string;
let developer: string;
beforeEach(async () => {
  ({ admin, staff, developer } = await staffCookies());
});

describe('価格表', () => {
  it('初期: 通常 500円(日付の既定)・イベント 800円(イベントの既定)。使っているアルバムの数', async () => {
    await insertAlbum();
    const r = await adminCall('/admin/api/photos/price-lists', { cookie: developer });
    expect(r.status).toBe(200);
    expect(r.body.priceLists).toEqual([
      { id: 1, name: '通常', unitPrice: 500, albumPrice: null, isDefaultFor: 'date', status: 'active', albumCount: 1 },
      { id: 2, name: 'イベント', unitPrice: 800, albumPrice: null, isDefaultFor: 'event', status: 'active', albumCount: 0 },
    ]);
  });

  it('作る。操作ログに残り、元に戻すと「使わない」になる(消さない)', async () => {
    const r = await adminCall('/admin/api/photos/price-lists', { cookie: admin, now: NOW, body: { name: '特別', unitPrice: 1000, albumPrice: 5000 } });
    expect(r.status).toBe(201);
    expect(r.body.priceList).toMatchObject({ name: '特別', unitPrice: 1000, albumPrice: 5000, isDefaultFor: null, status: 'active', albumCount: 0 });
    const log = await lastAudit('price_list.create');
    expect(log.target_type).toBe('price_list');
    expect((await undo(admin, log.id)).status).toBe(200);
    const row = await env.DB.prepare('SELECT status FROM price_lists WHERE id = ?').bind(r.body.priceList.id).first<any>();
    expect(row.status).toBe('archived');
  });

  it('入力のまちがい(50円より安い・名前がない)は 400', async () => {
    expect((await adminCall('/admin/api/photos/price-lists', { cookie: admin, body: { name: 'x', unitPrice: 30, albumPrice: null } })).status).toBe(400);
    expect((await adminCall('/admin/api/photos/price-lists', { cookie: admin, body: { name: '', unitPrice: 500, albumPrice: null } })).status).toBe(400);
  });

  it('価格表を変えると、使っているアルバムの価格にすぐ反映する。お支払い済みの注文の価格は変わらない', async () => {
    const a = await insertAlbum({ status: 'published', publishedAt: NOW });
    const p1 = await insertPhoto(a, { status: 'published' });
    const p2 = await insertPhoto(a, { status: 'published' });
    await env.DB.prepare('UPDATE album_photos SET price_override = 1500 WHERE photo_id = ?').bind(p2).run();
    const { orderItemId } = await insertSale(a, p1, 500);
    const r = await adminCall('/admin/api/photos/price-lists/1', { cookie: admin, method: 'PATCH', now: NOW, body: { unitPrice: 600, albumPrice: 3000 } });
    expect(r.status).toBe(200);
    expect(r.body.priceList).toMatchObject({ unitPrice: 600, albumPrice: 3000, albumCount: 1 });
    const d = await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin });
    expect(d.body.album).toMatchObject({ unitPrice: 600, albumPrice: 3000 });
    // 例外価格の写真はそのまま
    expect(d.body.photos.map((p: any) => p.price)).toEqual([600, 1500]);
    const item = await env.DB.prepare('SELECT unit_price FROM order_items WHERE id = ?').bind(orderItemId).first<any>();
    expect(item.unit_price).toBe(500);
    // 操作ログから元に戻せる
    const log = await lastAudit('price_list.update');
    expect(JSON.parse(log.before_value)).toMatchObject({ unitPrice: 500, albumPrice: null });
    expect((await undo(admin, log.id)).status).toBe(200);
    expect((await adminCall(`/admin/api/photos/albums/${a}`, { cookie: admin })).body.album.unitPrice).toBe(500);
  });

  it('使わないにする(消さない)。既定の価格表は使わないにできない', async () => {
    const def = await adminCall('/admin/api/photos/price-lists/1', { cookie: admin, method: 'PATCH', body: { status: 'archived' } });
    expect(def.status).toBe(409);
    expect(def.body.error.message).toContain('種類ごとの既定');
    const c = await adminCall('/admin/api/photos/price-lists', { cookie: admin, body: { name: '夏', unitPrice: 700, albumPrice: null } });
    const r = await adminCall(`/admin/api/photos/price-lists/${c.body.priceList.id}`, { cookie: admin, method: 'PATCH', body: { status: 'archived' } });
    expect(r.body.priceList.status).toBe('archived');
    // 一覧には残る(使わないものは最後)
    const list = await adminCall('/admin/api/photos/price-lists', { cookie: admin });
    expect(list.body.priceLists.at(-1)).toMatchObject({ name: '夏', status: 'archived' });
    // 使わないにした価格表で新しいアルバムは作れない
    const x = await adminCall('/admin/api/photos/albums', { cookie: admin, body: { name: 'x', kind: 'date', eventDate: '2026-11-03', priceListId: c.body.priceList.id } });
    expect(x.status).toBe(400);
  });

  it('種類ごとの既定を変える。新しいアルバムに付く。元に戻せる。同じ価格表を両方にはできない', async () => {
    const c = await adminCall('/admin/api/photos/price-lists', { cookie: admin, body: { name: '平日', unitPrice: 400, albumPrice: null } });
    const id = c.body.priceList.id;
    const r = await adminCall('/admin/api/photos/price-lists/defaults', { cookie: admin, method: 'PUT', now: NOW, body: { date: id, event: 2 } });
    expect(r.status).toBe(200);
    expect(r.body.priceLists.find((p: any) => p.id === id).isDefaultFor).toBe('date');
    expect(r.body.priceLists.find((p: any) => p.id === 1).isDefaultFor).toBeNull();
    const a = await adminCall('/admin/api/photos/albums', { cookie: admin, body: { name: 'x', kind: 'date', eventDate: '2026-11-03' } });
    expect(a.body.album.priceListId).toBe(id);
    const log = await lastAudit('price_list.defaults');
    expect((await undo(admin, log.id)).status).toBe(200);
    const back = await adminCall('/admin/api/photos/price-lists', { cookie: admin });
    expect(back.body.priceLists.find((p: any) => p.id === 1).isDefaultFor).toBe('date');
    const same = await adminCall('/admin/api/photos/price-lists/defaults', { cookie: admin, method: 'PUT', body: { date: 2, event: 2 } });
    expect(same.status).toBe(400);
  });

  it('受付は 403、製作者は変更が 403', async () => {
    expect((await adminCall('/admin/api/photos/price-lists', { cookie: staff })).status).toBe(403);
    for (const [method, path, body] of [
      ['POST', '/admin/api/photos/price-lists', { name: 'x', unitPrice: 500, albumPrice: null }],
      ['PATCH', '/admin/api/photos/price-lists/1', { unitPrice: 900 }],
      ['PUT', '/admin/api/photos/price-lists/defaults', { date: 2, event: 1 }],
    ] as const) {
      expect((await adminCall(path, { cookie: developer, method, body })).status).toBe(403);
      expect((await adminCall(path, { cookie: staff, method, body })).status).toBe(403);
    }
    const row = await env.DB.prepare('SELECT unit_price FROM price_lists WHERE id = 1').first<any>();
    expect(row.unit_price).toBe(500);
  });
});
