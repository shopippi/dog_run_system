import { sha256Hex } from '@dr/shared';
import initSqlJs from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { FallbackPhotoStorage } from '@api-src/lib/photos/storage';
import { DemoEngine } from '../src/engine/engine';
import { halloweenDate } from '../src/seed/photos';
import { DEMO_PASSWORD } from '../src/seed/fixtures';

// デモの写真販売の初期データ(seed/photos.ts・docs/demo.md 手順10)。販売は「する」、公開中のアルバム4つ、前の購入2件

const NOW = Date.parse('2026-11-03T03:00:00Z');
let engine: DemoEngine;
/** canvas の代わりの、小さな決まったバイト列(JPEG の頭と終わり) */
const fakeJpeg = async (variant: number, longEdge = 1800, opts: { watermark?: string } = {}) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, variant, longEdge % 256, opts.watermark ? 1 : 0, 0xff, 0xd9]);

const LIFF = (userId: string): [string, string][] => [['authorization', `Bearer mock:${userId}:${encodeURIComponent('テスト')}`]];
async function get<T>(jar: string, url: string, headers: [string, string][] = []) {
  const res = await engine.handle({ method: 'GET', url, headers, body: null }, jar);
  return { status: res.status, data: JSON.parse(new TextDecoder().decode(res.body ?? new ArrayBuffer(0)) || 'null') as T };
}

beforeAll(async () => {
  engine = await DemoEngine.create({ SQL: await initSqlJs(), memoryOnly: true, clock: () => NOW, photos: { makeSamplePhoto: fakeJpeg } });
});

describe('デモの写真販売', () => {
  it('公開中のアルバム4つ(日付3つ・ハロウィン)と、価格表(イベントはまるごと 4,000円)', () => {
    const albums = engine.select<{ name: string; kind: string; status: string; n: number }>(
      `SELECT a.name, a.kind, a.status, (SELECT COUNT(*) FROM album_photos ap WHERE ap.album_id = a.id AND ap.status = 'published') AS n FROM albums a ORDER BY a.id`,
    );
    expect(albums).toEqual([
      { name: '2026/11/02', kind: 'date', status: 'published', n: 16 },
      { name: '2026/10/27', kind: 'date', status: 'published', n: 14 },
      { name: 'ハロウィン仮装の日', kind: 'event', status: 'published', n: 16 },
      { name: '2026/10/20', kind: 'date', status: 'published', n: 12 },
    ]);
    expect(engine.select('SELECT name, unit_price, album_price FROM price_lists ORDER BY id')).toEqual([
      { name: '通常', unit_price: 500, album_price: null },
      { name: 'イベント', unit_price: 800, album_price: 4000 },
    ]);
  });

  it('お客さんの画面: 販売中で、アルバムが見える', async () => {
    const config = await get<{ available: boolean }>('liff', '/api/photos/config', LIFF('U-demo-mama'));
    expect(config.data.available).toBe(true);
    const list = await get<{ albums: { name: string }[] }>('liff', '/api/photos/albums', LIFF('U-demo-mama'));
    expect(list.data.albums.map((a) => a.name)).toEqual(['2026/11/02', 'ハロウィン仮装の日', '2026/10/27', '2026/10/20']);
  });

  it('こむぎママの購入した写真は3枚、nico.mama はハロウィンのまるごと', async () => {
    const mama = await get<{ albums: { name: string; photos: unknown[] }[] }>('liff', '/api/photos/purchases', LIFF('U-demo-mama'));
    expect(mama.data.albums.map((a) => [a.name, a.photos.length])).toEqual([['2026/10/27', 3]]);
    const nico = await get<{ albums: { name: string; photos: unknown[] }[] }>('liff', '/api/photos/purchases', LIFF('U-demo-nico'));
    expect(nico.data.albums.map((a) => [a.name, a.photos.length])).toEqual([['ハロウィン仮装の日', 16]]);
  });

  it('管理画面: 注文の一覧に2件', async () => {
    await engine.loginAs('admin', 'admin@example.com', DEMO_PASSWORD);
    const orders = await get<{ orders: { amount: number; status: string }[] }>('admin', '/admin/api/photos/orders');
    expect(orders.status).toBe(200);
    expect(orders.data.orders.map((o) => [o.amount, o.status]).sort()).toEqual([
      [1500, 'paid'],
      [4000, 'paid'],
    ]);
  });

  it('原本と購入済み領域のファイルは、代わりの置き場所からそのまま読める(SHA-256 が記録と同じ)', async () => {
    const storage = new FallbackPhotoStorage(engine.r2, 'demo');
    const [p] = engine.select<{ original_key: string; purchased_key: string; sha256: string }>(
      'SELECT original_key, purchased_key, sha256 FROM photos WHERE purchased_key IS NOT NULL ORDER BY id LIMIT 1',
    );
    expect(await storage.sha256(p!.original_key)).toBe(p!.sha256);
    expect(await storage.sha256(p!.purchased_key)).toBe(p!.sha256);
    expect(p!.sha256).toBe(await sha256Hex(await fakeJpeg(16 + 2, 1600)));
  });

  it('ハロウィンの日は、いちばん近い過去の 10月31日(遠ければ3週間前)', () => {
    expect(halloweenDate('2026-11-03')).toBe('2026-10-31');
    expect(halloweenDate('2026-10-31')).toBe('2026-10-31');
    expect(halloweenDate('2027-04-01')).toBe('2027-03-11');
  });
});
