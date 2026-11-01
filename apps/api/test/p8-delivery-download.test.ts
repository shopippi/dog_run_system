import { SELF, env } from 'cloudflare:test';
import { sha256Hex } from '@dr/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Bindings } from '../src/env';
import { R2PhotoStorage } from '../src/lib/photos/storage';
import { issueDownload } from '../src/services/photos/delivery';
import { jsCrc32 } from '../src/services/photos/zip';
import { BASE, call } from './helpers';
import { bytesOf, enablePhotoSales, parseStoreZip, purchase, readAll, revoke, seedAlbum } from './p8-delivery-seed';

// PU-7 購入した写真・ダウンロード・ZIP・回数の上限(PF-7。docs/photo-requirements.md 3.7)

const NOW = '2026-11-03T10:00:00+09:00';
const PAPA = 'U001:パパ';
const OTHER = 'U002:ほかの人';

beforeEach(async () => {
  await enablePhotoSales();
});

async function download(user: string, photoId: number, now = NOW, headers: Record<string, string> = {}) {
  return call(`/api/photos/purchases/${photoId}/download`, { user, method: 'POST', now, headers });
}

async function fetchBytes(url: string, now?: string) {
  const res = await SELF.fetch(url, { headers: now ? { 'x-debug-now': now } : {} });
  return { res, bytes: await readAll(res.body) };
}

describe('購入した写真の一覧(GET /api/photos/purchases)', () => {
  it('自分の購入だけを、アルバム別に返す。返金した写真は出さない。販売終了のアルバムも出す', async () => {
    const a = await seedAlbum({ name: '2026/11/01', photos: 3 });
    const b = await seedAlbum({ name: '秋の運動会', photos: 2, status: 'ended', saleEndsAt: '2026-11-02T00:00:00+09:00' });
    const mine = await purchase(PAPA, a.albumId, [a.photos[0]!.id, a.photos[2]!.id]);
    await purchase(PAPA, b.albumId, [b.photos[1]!.id]);
    await purchase(OTHER, a.albumId, [a.photos[1]!.id]);
    await revoke(mine.entitlementIds[1]!);

    const r = await call('/api/photos/purchases', { user: PAPA, now: NOW });
    expect(r.status).toBe(200);
    expect(r.body.albums).toHaveLength(2);
    const ids = r.body.albums.flatMap((x: any) => x.photos.map((p: any) => p.photoId));
    expect(ids.sort()).toEqual([a.photos[0]!.id, b.photos[1]!.id].sort());
    const photo = r.body.albums.find((x: any) => x.albumId === a.albumId).photos[0];
    expect(photo).toMatchObject({
      photoId: a.photos[0]!.id,
      filename: 'IMG_1001.JPG',
      viewUrl: `/api/photos/purchases/${a.photos[0]!.id}/view`,
      downloadsRemaining: 10,
      purchasedAt: '2026-11-02T12:00:00+09:00',
    });
    // ほかの人には、パパの購入は見えない
    const other = await call('/api/photos/purchases', { user: OTHER, now: NOW });
    expect(other.body.albums.flatMap((x: any) => x.photos.map((p: any) => p.photoId))).toEqual([a.photos[1]!.id]);
    // 何も買っていない人は空
    expect((await call('/api/photos/purchases', { user: 'U003:ゲスト', now: NOW })).body).toEqual({ albums: [] });
  });
});

describe('透かしなしの中サイズ(GET /api/photos/purchases/:photoId/view)', () => {
  it('権利がある人だけ。ほかの人・返金した写真は 403', async () => {
    const a = await seedAlbum({ photos: 2 });
    const p = await purchase(PAPA, a.albumId, [a.photos[0]!.id, a.photos[1]!.id]);
    const res = await SELF.fetch(`${BASE}/api/photos/purchases/${a.photos[0]!.id}/view`, {
      headers: { authorization: 'Bearer mock:U001:%E3%83%91%E3%83%91', 'x-debug-now': NOW },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toContain('private');
    expect(await readAll(res.body)).toEqual(bytesOf(500, 700));

    const other = await call(`/api/photos/purchases/${a.photos[0]!.id}/view`, { user: OTHER, now: NOW });
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('not_entitled');

    await revoke(p.entitlementIds[1]!);
    expect((await call(`/api/photos/purchases/${a.photos[1]!.id}/view`, { user: PAPA, now: NOW })).status).toBe(403);
  });
});

describe('原本のダウンロード(POST /api/photos/purchases/:photoId/download)', () => {
  it('権利を確かめてから5分の URL を返す。受け取ったファイルは原本とバイト単位で同じ', async () => {
    // 原本は部分に分けて保存(代わりの置き場所の目次の形)
    const a = await seedAlbum({ photos: 1, sizes: [5000], partSize: 1500 });
    await purchase(PAPA, a.albumId, [a.photos[0]!.id]);
    const r = await download(PAPA, a.photos[0]!.id, NOW, { 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'TestPhone/1.0' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ filename: 'IMG_1001.JPG', expiresAt: '2026-11-03T10:05:00+09:00' });
    expect(r.body.url).toMatch(/^https:\/\/dogrun\.test\/api\/photos\/files\/[\w-]+\.[\w-]+$/);

    const { res, bytes } = await fetchBytes(r.body.url, '2026-11-03T10:04:59+09:00');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('IMG_1001.JPG');
    expect(await sha256Hex(bytes)).toBe(a.photos[0]!.sha256);
    expect(bytes).toEqual(a.photos[0]!.original);

    // 5分を過ぎた URL は使えない(410)
    const late = await fetchBytes(r.body.url, '2026-11-03T10:05:01+09:00');
    expect(late.res.status).toBe(410);

    // 記録: IP そのものは残さず、ハッシュだけ
    const log = await env.DB.prepare('SELECT kind, ip_hash, user_agent, entitlement_id FROM download_logs').first<any>();
    expect(log.kind).toBe('original');
    expect(log.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(log.ip_hash).not.toContain('203.0.113.5');
    expect(log.user_agent).toBe('TestPhone/1.0');
    expect(log.entitlement_id).not.toBeNull();
  });

  it('購入済み領域へのコピーの前でも、原本(同じバイト)を渡す', async () => {
    const a = await seedAlbum({ photos: 1 });
    await purchase(PAPA, a.albumId, [a.photos[0]!.id], { copy: false });
    const r = await download(PAPA, a.photos[0]!.id);
    expect(r.status).toBe(200);
    expect((await fetchBytes(r.body.url, NOW)).bytes).toEqual(a.photos[0]!.original);
  });

  it('権利がない・ほかの人・返金した写真は 403(URL を作らない、記録もしない)', async () => {
    const a = await seedAlbum({ photos: 2 });
    const p = await purchase(PAPA, a.albumId, [a.photos[0]!.id, a.photos[1]!.id]);
    const other = await download(OTHER, a.photos[0]!.id);
    expect(other.status).toBe(403);
    expect(other.body.error).toMatchObject({ code: 'not_entitled' });
    expect(other.body.error.message).toContain('購入した写真');
    await revoke(p.entitlementIds[1]!);
    expect((await download(PAPA, a.photos[1]!.id)).status).toBe(403);
    expect((await download(PAPA, 99999)).status).toBe(403);
    expect((await download(PAPA, 0)).status).toBe(404);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM download_logs').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('R2 のときは、5分(300秒)で切れる署名つき URL(ファイル名つき)', async () => {
    const a = await seedAlbum({ photos: 1 });
    const p = await purchase(PAPA, a.albumId, [a.photos[0]!.id]);
    const r2 = new R2PhotoStorage({
      endpoint: 'https://acc.r2.cloudflarestorage.com',
      bucket: 'photos',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      region: 'auto',
      bucketBinding: env.MEDIA,
    });
    const now = new Date(NOW);
    const out = await issueDownload(
      {
        db: env.DB,
        env: env as unknown as Bindings,
        storage: r2,
        customerId: p.customerId,
        now,
        origin: BASE,
        limit: { count: 10, hours: 24 },
        ipHash: null,
        userAgent: null,
      },
      a.photos[0]!.id,
    );
    const u = new URL(out.url);
    expect(u.origin).toBe('https://acc.r2.cloudflarestorage.com');
    expect(u.pathname).toMatch(/^\/photos\/purchased\//);
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(u.searchParams.get('response-content-disposition')).toContain('IMG_1001.JPG');
    expect(out.expiresAt).toBe('2026-11-03T10:05:00+09:00');
  });
});

describe('回数の上限(写真1枚につき24時間で10回)', () => {
  it('10回まで。11回目は 429 と、いつからまたできるか', async () => {
    const a = await seedAlbum({ photos: 2 });
    await purchase(PAPA, a.albumId, [a.photos[0]!.id, a.photos[1]!.id]);
    for (let i = 0; i < 10; i++) {
      const at = `2026-11-03T10:${String(i).padStart(2, '0')}:00+09:00`;
      expect((await download(PAPA, a.photos[0]!.id, at)).status, `${i + 1}回目`).toBe(200);
    }
    const r = await download(PAPA, a.photos[0]!.id, '2026-11-03T11:00:00+09:00');
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('download_limit');
    expect(r.body.error.details.resetsAt).toBe('2026-11-04T10:00:00+09:00');
    expect(r.body.error.message).toContain('24時間で10回');
    expect(r.body.error.message).toContain('11月4日 10:00ごろから、またダウンロードできます');
    // 上限は写真ごと。ほかの写真は取れる
    expect((await download(PAPA, a.photos[1]!.id, '2026-11-03T11:00:00+09:00')).status).toBe(200);
    // 一覧の残り
    const list = await call('/api/photos/purchases', { user: PAPA, now: '2026-11-03T11:00:00+09:00' });
    const remaining = Object.fromEntries(list.body.albums[0].photos.map((p: any) => [p.photoId, p.downloadsRemaining]));
    expect(remaining).toEqual({ [a.photos[0]!.id]: 0, [a.photos[1]!.id]: 9 });
    // 窓から出たら、またできる
    expect((await download(PAPA, a.photos[0]!.id, '2026-11-04T10:00:01+09:00')).status).toBe(200);
    // 記録は上限の分だけ(超えた要求は記録しない)
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM download_logs WHERE photo_id = ?').bind(a.photos[0]!.id).first<{ n: number }>();
    expect(n!.n).toBe(11);
  });

  it('上限は設定で変えられる(photo_download_limit)', async () => {
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_download_limit', ?, ?)")
      .bind(JSON.stringify({ count: 3, hours: 1 }), NOW)
      .run();
    const a = await seedAlbum({ photos: 1 });
    await purchase(PAPA, a.albumId, [a.photos[0]!.id]);
    for (let i = 0; i < 3; i++) expect((await download(PAPA, a.photos[0]!.id)).status).toBe(200);
    const r = await download(PAPA, a.photos[0]!.id);
    expect(r.status).toBe(429);
    expect(r.body.error.message).toContain('1時間で3回');
    expect((await download(PAPA, a.photos[0]!.id, '2026-11-03T11:00:01+09:00')).status).toBe(200);
  });
});

describe('まとめて ZIP(POST /api/photos/purchases/zip)', () => {
  it('無圧縮の ZIP。中のファイルは原本と SHA-256 が同じ', async () => {
    const a = await seedAlbum({ photos: 3, sizes: [4100, 1, 2500], partSize: 1000 });
    // 同じファイル名の写真が別のアルバムにある
    const b = await seedAlbum({ photos: 1, sizes: [777] });
    await purchase(PAPA, a.albumId, a.photos.map((p) => p.id));
    await purchase(PAPA, b.albumId, [b.photos[0]!.id]);
    const ids = [...a.photos.map((p) => p.id), b.photos[0]!.id];
    const r = await call('/api/photos/purchases/zip', { user: PAPA, now: NOW, body: { photoIds: ids } });
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/dogrun\.test\/api\/photos\/files\/zip\//);
    expect(r.body.filename).toBe('グリーンドーム_写真_20261103.zip');
    expect(r.body.expiresAt).toBe('2026-11-03T10:05:00+09:00');

    const { res, bytes } = await fetchBytes(r.body.url, '2026-11-03T10:04:00+09:00');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain(encodeURIComponent('グリーンドーム_写真_20261103.zip'));
    expect(Number(res.headers.get('content-length'))).toBe(bytes.length);

    const entries = parseStoreZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(['IMG_1001.JPG', 'IMG_1002.JPG', 'IMG_1003.JPG', 'IMG_1001 (2).JPG']);
    const originals = [...a.photos, b.photos[0]!];
    for (const [i, e] of entries.entries()) {
      expect(e.method, e.name).toBe(0); // STORE(無圧縮)
      expect(await sha256Hex(e.data), e.name).toBe(originals[i]!.sha256);
      expect(e.crc, e.name).toBe(jsCrc32(e.data));
    }
    // 1枚ずつ回数に数える(kind = zip)
    const logs = await env.DB.prepare("SELECT COUNT(*) AS n FROM download_logs WHERE kind = 'zip'").first<{ n: number }>();
    expect(logs!.n).toBe(4);

    // 5分を過ぎた URL・改ざんした URL は使えない
    expect((await fetchBytes(r.body.url, '2026-11-03T10:05:01+09:00')).res.status).toBe(410);
    expect((await fetchBytes(r.body.url.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A')), NOW)).res.status).toBe(410);
  });

  it('ほかの人の写真・返金した写真が入っていたら 403。URL を作ったあとに返金した写真は入れない', async () => {
    const a = await seedAlbum({ photos: 3 });
    const mine = await purchase(PAPA, a.albumId, [a.photos[0]!.id, a.photos[1]!.id]);
    await purchase(OTHER, a.albumId, [a.photos[2]!.id]);
    const bad = await call('/api/photos/purchases/zip', { user: PAPA, now: NOW, body: { photoIds: [a.photos[0]!.id, a.photos[2]!.id] } });
    expect(bad.status).toBe(403);
    expect(bad.body.error.details.photoIds).toEqual([a.photos[2]!.id]);

    const ok = await call('/api/photos/purchases/zip', { user: PAPA, now: NOW, body: { photoIds: [a.photos[0]!.id, a.photos[1]!.id] } });
    expect(ok.status).toBe(200);
    await revoke(mine.entitlementIds[1]!);
    const entries = parseStoreZip((await fetchBytes(ok.body.url, NOW)).bytes);
    expect(entries.map((e) => e.name)).toEqual(['IMG_1001.JPG']);
  });

  it('ZIP の1枚も上限に数える。上限なら 429', async () => {
    const a = await seedAlbum({ photos: 2 });
    await purchase(PAPA, a.albumId, [a.photos[0]!.id, a.photos[1]!.id]);
    for (let i = 0; i < 10; i++) {
      expect((await call('/api/photos/purchases/zip', { user: PAPA, now: NOW, body: { photoIds: [a.photos[0]!.id] } })).status).toBe(200);
    }
    const r = await call('/api/photos/purchases/zip', { user: PAPA, now: NOW, body: { photoIds: [a.photos[1]!.id, a.photos[0]!.id] } });
    expect(r.status).toBe(429);
    expect(r.body.error.details.photoIds).toEqual([a.photos[0]!.id]);
    expect((await download(PAPA, a.photos[0]!.id)).status).toBe(429);
    // 101枚以上はまとめられない
    const many = await call('/api/photos/purchases/zip', { user: PAPA, now: NOW, body: { photoIds: Array.from({ length: 101 }, (_, i) => i + 1) } });
    expect(many.status).toBe(400);
  });
});
