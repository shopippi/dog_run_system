import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Bindings } from '../src/env';
import { photoSaleEndJob, runPhotoSaleEnd } from '../src/services/photos/sale-end';
import { call } from './helpers';
import { addToAlbum, enablePhotoSales, purchase, readAll, seedAlbum, storage } from './p8-delivery-seed';

// PF-8 販売期間と自動削除(毎晩 3:10。docs/photo-requirements.md 3.2・3.8)

const PAPA = 'U001:パパ';
const at = (s: string) => new Date(s);
const ENV = env as unknown as Bindings;

async function exists(key: string): Promise<boolean> {
  return (await storage().head(key)) !== null;
}
async function albumRow(id: number) {
  return env.DB.prepare('SELECT status, ended_at, deletion_notice_at, files_deleted_at FROM albums WHERE id = ?').bind(id).first<any>();
}
async function photoRow(id: number) {
  return env.DB.prepare('SELECT files_deleted_at, purchased_key FROM photos WHERE id = ?').bind(id).first<any>();
}

/** 写真の置き場所の delete が、決まったキーで失敗する env(途中の失敗を確かめる) */
function envFailingDeleteOf(badKey: string): Bindings {
  const media = env.MEDIA;
  const wrapped = {
    get: (...a: Parameters<R2Bucket['get']>) => media.get(...a),
    head: (k: string) => media.head(k),
    put: (...a: Parameters<R2Bucket['put']>) => media.put(...a),
    list: (o?: R2ListOptions) => media.list(o),
    delete: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      if (list.some((k) => k.endsWith(badKey))) throw new Error('R2 delete 500');
      return media.delete(keys);
    },
  } as unknown as R2Bucket;
  const out = Object.create(env) as Bindings;
  Object.defineProperty(out, 'MEDIA', { value: wrapped });
  return out;
}

describe('販売終了の自動処理(runPhotoSaleEnd)', () => {
  let A: Awaited<ReturnType<typeof seedAlbum>>;
  let B: Awaited<ReturnType<typeof seedAlbum>>;
  beforeEach(async () => {
    await enablePhotoSales();
    // A: 11/10 に販売終了。1枚目は売れた、2枚目は B にも載っている、3枚目は売れなかった
    A = await seedAlbum({ name: '2026/10/10', saleEndsAt: '2026-11-10T10:00:00+09:00', photos: 3 });
    B = await seedAlbum({ name: '秋の運動会', saleEndsAt: '2027-05-01T10:00:00+09:00', photos: 1 });
    await addToAlbum(B.albumId, A.photos[1]!.id);
    await purchase(PAPA, A.albumId, [A.photos[0]!.id]);
  });

  it('7日前にお知らせを出す。何度動かしても1回だけ', async () => {
    const r1 = await runPhotoSaleEnd(ENV, at('2026-11-03T03:09:00+09:00'));
    expect(r1).toMatchObject({ notices: 0, ended: 0, endingSoon: [] });
    const r2 = await runPhotoSaleEnd(ENV, at('2026-11-04T03:10:00+09:00'));
    expect(r2).toMatchObject({ notices: 1, ended: 0, status: 'ok' });
    expect(r2.endingSoon).toEqual([{ albumId: A.albumId, name: '2026/10/10', saleEndsAt: '2026-11-10T10:00:00+09:00' }]);
    expect(r2.message).toContain('販売終了まで7日以内のアルバムが1つあります(「2026/10/10」)');
    expect((await albumRow(A.albumId)).deletion_notice_at).toBe('2026-11-04T03:10:00+09:00');
    const r3 = await runPhotoSaleEnd(ENV, at('2026-11-05T03:10:00+09:00'));
    expect(r3.notices).toBe(0);
    expect(r3.endingSoon).toHaveLength(1);
    expect((await albumRow(A.albumId)).deletion_notice_at).toBe('2026-11-04T03:10:00+09:00');
  });

  it('延長したアルバムは終わらない。お知らせは戻り、新しい終了の7日前にまた出る', async () => {
    await runPhotoSaleEnd(ENV, at('2026-11-04T03:10:00+09:00'));
    await env.DB.prepare("UPDATE albums SET sale_ends_at = '2026-12-31T10:00:00+09:00' WHERE id = ?").bind(A.albumId).run();
    const r = await runPhotoSaleEnd(ENV, at('2026-11-11T03:10:00+09:00'));
    expect(r.ended).toBe(0);
    expect(await albumRow(A.albumId)).toMatchObject({ status: 'published', deletion_notice_at: null, files_deleted_at: null });
    expect(await exists(A.photos[2]!.keys.original)).toBe(true);
    const again = await runPhotoSaleEnd(ENV, at('2026-12-25T03:10:00+09:00'));
    expect(again.notices).toBe(1);
  });

  it('終了の日を過ぎたら販売終了。売れなかった写真のファイルだけ消える。行は残る', async () => {
    const r = await runPhotoSaleEnd(ENV, at('2026-11-11T03:10:00+09:00'));
    expect(r).toMatchObject({ ended: 1, filesDeleted: 1, failed: 0, deferred: 0, status: 'ok' });
    expect(r.message).toContain('1つのアルバムを販売終了にしました');
    expect(await albumRow(A.albumId)).toMatchObject({ status: 'ended', ended_at: '2026-11-11T03:10:00+09:00', files_deleted_at: '2026-11-11T03:10:00+09:00' });

    // 売れなかった写真: 原本・プレビュー・サムネイル・中サイズのファイルが消え、行に印
    const unsold = A.photos[2]!;
    for (const k of Object.values(unsold.keys)) expect(await exists(k), k).toBe(false);
    expect((await photoRow(unsold.id)).files_deleted_at).toBe('2026-11-11T03:10:00+09:00');
    // 売れた写真: 原本・中サイズ・購入済み領域のファイルは残る
    const sold = A.photos[0]!;
    const soldRow = await photoRow(sold.id);
    expect(soldRow.files_deleted_at).toBeNull();
    for (const k of [sold.keys.original, sold.keys.view, soldRow.purchased_key]) expect(await exists(k), k).toBe(true);
    // ほかの販売中のアルバムに載っている写真は残る
    for (const k of Object.values(A.photos[1]!.keys)) expect(await exists(k), k).toBe(true);
    expect((await photoRow(A.photos[1]!.id)).files_deleted_at).toBeNull();
    // 行は消さない(アルバム・写真・掲載)
    const counts = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM albums) AS a, (SELECT COUNT(*) FROM photos) AS p, (SELECT COUNT(*) FROM album_photos) AS ap, (SELECT COUNT(*) FROM entitlements) AS e',
    ).first<any>();
    expect(counts).toEqual({ a: 2, p: 4, ap: 5, e: 1 });
    // 操作ログ(自動処理)
    const logs = await env.DB.prepare("SELECT action, actor_type FROM audit_log WHERE target_type = 'photo_album' ORDER BY id").all<any>();
    expect(logs.results).toEqual([
      { action: 'photo_album.sale_end', actor_type: 'system' },
      { action: 'photo_album.files_delete', actor_type: 'system' },
    ]);

    // 購入した人は、販売終了のあとも見られる・ダウンロードできる(バイト単位で同じ)
    const list = await call('/api/photos/purchases', { user: PAPA, now: '2026-11-11T09:00:00+09:00' });
    expect(list.body.albums[0].photos.map((p: any) => p.photoId)).toEqual([sold.id]);
    const dl = await call(`/api/photos/purchases/${sold.id}/download`, { user: PAPA, method: 'POST', now: '2026-11-11T09:00:00+09:00' });
    expect(dl.status).toBe(200);
    const { SELF } = await import('cloudflare:test');
    const res = await SELF.fetch(dl.body.url, { headers: { 'x-debug-now': '2026-11-11T09:01:00+09:00' } });
    expect(await readAll(res.body)).toEqual(sold.original);
    expect((await call(`/api/photos/purchases/${sold.id}/view`, { user: PAPA, now: '2026-11-11T09:00:00+09:00' })).status).toBe(200);
  });

  it('もう一度動かしても同じ(何もしない)。ほかのアルバムが終わったら、そこに載っていた写真も消える', async () => {
    await runPhotoSaleEnd(ENV, at('2026-11-11T03:10:00+09:00'));
    const again = await runPhotoSaleEnd(ENV, at('2026-11-11T03:20:00+09:00'));
    expect(again).toMatchObject({ ended: 0, filesDeleted: 0, failed: 0, status: 'ok' });
    expect(again.message).toBe('販売終了にするアルバムはありませんでした。');
    // B も終わると、B の写真と、A から載せていた写真が消える
    const r = await runPhotoSaleEnd(ENV, at('2027-05-02T03:10:00+09:00'));
    expect(r).toMatchObject({ ended: 1, filesDeleted: 2 });
    expect((await photoRow(A.photos[1]!.id)).files_deleted_at).toBe('2027-05-02T03:10:00+09:00');
    expect((await photoRow(A.photos[0]!.id)).files_deleted_at).toBeNull();
  });

  it('お支払い待ちの注文に入っている写真は、その晩は消さない(次の晩に)', async () => {
    await purchase('U005:まだ払っていない人', A.albumId, [A.photos[2]!.id], { status: 'pending', paidAt: '2026-11-10T09:00:00+09:00' });
    const r = await runPhotoSaleEnd(ENV, at('2026-11-11T03:10:00+09:00'));
    expect(r).toMatchObject({ ended: 1, filesDeleted: 0, deferred: 1 });
    expect((await albumRow(A.albumId)).files_deleted_at).toBeNull();
    expect(await exists(A.photos[2]!.keys.original)).toBe(true);
    // 2日たって、払われなかった注文は数えない
    const later = await runPhotoSaleEnd(ENV, at('2026-11-13T03:10:00+09:00'));
    expect(later).toMatchObject({ filesDeleted: 1, deferred: 0 });
    expect((await albumRow(A.albumId)).files_deleted_at).toBe('2026-11-13T03:10:00+09:00');
  });

  it('途中で失敗しても、ほかは続け、次の晩にやり直す', async () => {
    const C = await seedAlbum({ name: '失敗する', saleEndsAt: '2026-11-10T10:00:00+09:00', photos: 2 });
    const bad = C.photos[0]!.keys.thumb;
    const r = await runPhotoSaleEnd(envFailingDeleteOf(bad), at('2026-11-11T03:10:00+09:00'));
    expect(r).toMatchObject({ ended: 2, filesDeleted: 2, failed: 1, status: 'warning' });
    expect(r.message).toContain('次の晩に自動でやり直します');
    expect(r.detail).toContain('R2 delete 500');
    expect((await albumRow(A.albumId)).files_deleted_at).not.toBeNull();
    expect((await albumRow(C.albumId)).files_deleted_at).toBeNull();
    expect((await photoRow(C.photos[0]!.id)).files_deleted_at).toBeNull();
    expect((await photoRow(C.photos[1]!.id)).files_deleted_at).not.toBeNull();
    // 次の晩
    const next = await runPhotoSaleEnd(ENV, at('2026-11-12T03:10:00+09:00'));
    expect(next).toMatchObject({ filesDeleted: 1, failed: 0, status: 'ok' });
    expect((await albumRow(C.albumId)).files_deleted_at).toBe('2026-11-12T03:10:00+09:00');
    for (const k of Object.values(C.photos[0]!.keys)) expect(await exists(k)).toBe(false);
  });

  it('途中でやめたアップロード(3日より古い)を片付ける', async () => {
    const s = storage();
    await s.putPart!('originals/x/abandoned.jpg', 1, new Uint8Array([1, 2, 3]).buffer);
    const photo = await env.DB.prepare(
      `INSERT INTO photos (original_key, sha256, bytes, content_type, original_filename, status, created_at)
       VALUES ('originals/x/abandoned.jpg', ?, 3, 'image/jpeg', 'a.jpg', 'uploading', '2026-11-01T10:00:00+09:00') RETURNING id`,
    )
      .bind('0'.repeat(64))
      .first<{ id: number }>();
    await env.DB.prepare(
      `INSERT INTO photo_uploads (id, photo_id, album_id, storage, part_size, part_count, created_at, updated_at)
       VALUES ('u-old', ?, ?, 'fallback', 1572864, 1, '2026-11-01T10:00:00+09:00', '2026-11-01T10:00:00+09:00')`,
    )
      .bind(photo!.id, B.albumId)
      .run();
    expect((await s.listParts('originals/x/abandoned.jpg', null, new Date())).length).toBe(1);
    const early = await runPhotoSaleEnd(ENV, at('2026-11-03T03:10:00+09:00'));
    expect(early.uploadsAborted).toBe(0);
    const r = await runPhotoSaleEnd(ENV, at('2026-11-04T10:00:01+09:00'));
    expect(r.uploadsAborted).toBe(1);
    expect((await s.listParts('originals/x/abandoned.jpg', null, new Date())).length).toBe(0);
    const u = await env.DB.prepare("SELECT status FROM photo_uploads WHERE id = 'u-old'").first<any>();
    expect(u.status).toBe('aborted');
  });

  it('システムの状態に残す形(photoSaleEndJob)', async () => {
    const out = await photoSaleEndJob(ENV, at('2026-11-04T03:10:00+09:00'));
    expect(out.status).toBe('ok');
    expect(out.message).toContain('販売終了まで7日以内');
  });
});
