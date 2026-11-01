import { sha256Hex } from '@dr/shared';
import initSqlJs from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { FallbackPhotoStorage } from '@api-src/lib/photos/storage';
import { DemoEngine } from '../src/engine/engine';

// デモの写真販売のつなぎ口(seed/photos.ts)。見本の写真で、下書きのアルバムを2つ作る

const NOW = Date.parse('2026-11-03T03:00:00Z');
let engine: DemoEngine;
/** canvas の代わりの、小さな決まったバイト列(JPEG の頭だけ) */
const fakeJpeg = async (variant: number, longEdge = 1800) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, variant, longEdge % 256, 0xff, 0xd9]);

beforeAll(async () => {
  engine = await DemoEngine.create({ SQL: await initSqlJs(), memoryOnly: true, clock: () => NOW, photos: { makeSamplePhoto: fakeJpeg } });
});

describe('デモの写真販売の見本', () => {
  it('日付とイベントのアルバムを、下書きで作る(販売は止めたまま)', () => {
    const albums = engine.select<{ name: string; kind: string; status: string; n: number }>(
      `SELECT a.name, a.kind, a.status, (SELECT COUNT(*) FROM album_photos ap WHERE ap.album_id = a.id) AS n FROM albums a ORDER BY a.id`,
    );
    expect(albums).toEqual([
      { name: '2026/11/02', kind: 'date', status: 'draft', n: 6 },
      { name: '秋のわんわん運動会', kind: 'event', status: 'draft', n: 6 },
    ]);
    expect(engine.select("SELECT value FROM settings WHERE key = 'photo_sales_enabled'")).toEqual([]);
  });

  it('原本は API の代わりの置き場所から、そのまま読める(SHA-256 が記録と同じ)', async () => {
    const [p] = engine.select<{ original_key: string; sha256: string }>('SELECT original_key, sha256 FROM photos ORDER BY id LIMIT 1');
    const storage = new FallbackPhotoStorage(engine.r2, 'demo');
    expect(await storage.sha256(p!.original_key)).toBe(p!.sha256);
    expect(p!.sha256).toBe(await sha256Hex(await fakeJpeg(0, 1800)));
  });
});
