import { env } from 'cloudflare:test';
import { FALLBACK_PART_SIZE, sha256Hex } from '@dr/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { R2PhotoStorage, photoStorage, sha256OfStream } from '../src/lib/photos/storage';
import { completeUpload, derivativeTarget, partTargets, startUpload } from '../src/services/photos/admin-upload';
import { NOW, adminCall, bytesOf, insertAlbum, insertPhoto, lastAudit, putTo, staffCookies, undo } from './p8-admin-helpers';

// 段階1-A(管理)。PA-2 一斉アップロード(PF-2)。代わりの置き場所で通しで確かめ、R2 の送り先は R2 の実装(fetch のまね)で確かめる

let admin: string;
let staff: string;
let developer: string;
beforeEach(async () => {
  ({ admin, staff, developer } = await staffCookies());
});

const jpeg = (n: number) => bytesOf(n, n);

type Started = { duplicate: false; photoId: number; uploadId: string; storage: string; partSize: number; partCount: number };

async function start(albumId: number, bytes: Uint8Array, opts: { filename?: string; sha256?: string; cookie?: string } = {}) {
  return adminCall<any>(`/admin/api/photos/albums/${albumId}/uploads`, {
    cookie: opts.cookie ?? admin,
    now: NOW,
    body: { filename: opts.filename ?? 'IMG_0001.JPG', bytes: bytes.byteLength, contentType: 'image/jpeg', sha256: opts.sha256 ?? (await sha256Hex(bytes)), width: 4000, height: 3000 },
  });
}

async function sendParts(up: Started, bytes: Uint8Array, only?: number[]) {
  const numbers = only ?? Array.from({ length: up.partCount }, (_, i) => i + 1);
  const t = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/parts`, { cookie: admin, now: NOW, body: { partNumbers: numbers } });
  expect(t.status).toBe(200);
  const etags: { partNumber: number; etag: string }[] = [];
  for (const p of t.body.parts) {
    const slice = bytes.slice((p.partNumber - 1) * up.partSize, p.partNumber * up.partSize);
    const r = await putTo(p, slice, admin);
    expect(r.status).toBe(200);
    etags.push({ partNumber: p.partNumber, etag: r.body.etag });
  }
  return etags;
}

async function sendDerivatives(uploadId: string, kinds = ['preview', 'thumb', 'view']) {
  for (const kind of kinds) {
    const body = jpeg(300 + kind.length);
    const t = await adminCall<any>(`/admin/api/photos/uploads/${uploadId}/derivatives`, { cookie: admin, now: NOW, body: { kind, bytes: body.byteLength, contentType: 'image/jpeg' } });
    expect(t.status).toBe(200);
    expect(t.body.headers['content-type']).toBe('image/jpeg');
    expect((await putTo(t.body, body, admin)).status).toBe(200);
  }
}

async function uploadOne(albumId: number, bytes: Uint8Array, filename = 'IMG_0001.JPG') {
  const s = await start(albumId, bytes, { filename });
  expect(s.status).toBe(200);
  const up = s.body as Started;
  const parts = await sendParts(up, bytes);
  await sendDerivatives(up.uploadId);
  const c = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/complete`, { cookie: admin, now: NOW, body: { parts } });
  return { up, complete: c };
}

describe('アップロード(代わりの置き場所)', () => {
  it('部分に分けて送り、完了でサーバーが SHA-256 を確かめる。つなげた原本はバイト単位で同じ', async () => {
    const a = await insertAlbum();
    const bytes = jpeg(FALLBACK_PART_SIZE * 2 + 12345);
    const s = await start(a, bytes);
    expect(s.body).toMatchObject({ duplicate: false, storage: 'fallback', partSize: FALLBACK_PART_SIZE, partCount: 3 });
    const up = s.body as Started;
    // 送り先は Worker の URL(x-dr-admin を付ける)
    const t = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/parts`, { cookie: admin, body: { partNumbers: [1] } });
    expect(t.body.parts[0]).toMatchObject({ partNumber: 1, method: 'PUT', headers: { 'x-dr-admin': '1' } });
    expect(new URL(t.body.parts[0].url).pathname).toBe(`/admin/api/photos/uploads/${up.uploadId}/parts/1`);
    const parts = await sendParts(up, bytes);
    await sendDerivatives(up.uploadId);
    const c = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/complete`, { cookie: admin, now: NOW, body: { parts } });
    expect(c.status).toBe(200);
    expect(c.body).toEqual({ photoId: up.photoId, verified: true });

    const photo = await env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(up.photoId).first<any>();
    expect(photo).toMatchObject({ status: 'ready', sha256_verified_at: NOW, uploaded_at: NOW, hash_mismatch_at: null, original_filename: 'IMG_0001.JPG', bytes: bytes.byteLength });
    // キーはランダム(元のファイル名を含めない)
    expect(photo.original_key).toMatch(/^originals\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
    expect(photo.original_key).not.toContain('IMG');
    // 置き場所から読み直して、元のバイトと同じか
    const file = await photoStorage(env as any)!.get(photo.original_key);
    expect(file!.size).toBe(bytes.byteLength);
    expect(await sha256OfStream(file!.body)).toBe(await sha256Hex(bytes));
    // アルバムに下書きで入る
    const ap = await env.DB.prepare('SELECT status FROM album_photos WHERE album_id = ? AND photo_id = ?').bind(a, up.photoId).first<any>();
    expect(ap.status).toBe('draft');
    const st = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}`, { cookie: admin });
    expect(st.body).toMatchObject({ status: 'completed', derivatives: ['preview', 'thumb', 'view'] });
    expect((await lastAudit('photo.upload')).target_id).toBe(String(up.photoId));
    // 管理画面のサムネイルは届いたものを返す
    expect((await adminCall(`/admin/api/photos/photos/${up.photoId}/thumb`, { cookie: admin })).status).toBe(200);
  });

  it('同じアルバムに同じ写真(SHA-256)があれば、送らずに飛ばす(duplicate)。ほかのアルバムには送れる', async () => {
    const a = await insertAlbum();
    const b = await insertAlbum({ name: '運動会', kind: 'event' });
    const bytes = jpeg(5000);
    const { up } = await uploadOne(a, bytes);
    const again = await start(a, bytes, { filename: 'IMG_0001(1).JPG' });
    expect(again.body).toEqual({ duplicate: true, photoId: up.photoId });
    const other = await start(b, bytes);
    expect(other.body.duplicate).toBe(false);
  });

  it('途中で切れても続きから: 同じ写真を始め直すと同じアップロード。送り終えた部分が分かる', async () => {
    const a = await insertAlbum();
    const bytes = jpeg(FALLBACK_PART_SIZE + 999);
    const s = await start(a, bytes);
    const up = s.body as Started;
    await sendParts(up, bytes, [1]);
    // 画面を読み込み直した → もう一度始める
    const again = await start(a, bytes);
    expect(again.body.uploadId).toBe(up.uploadId);
    const st = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}`, { cookie: admin });
    expect(st.body.status).toBe('uploading');
    expect(st.body.parts.map((p: any) => p.partNumber)).toEqual([1]);
    expect(st.body.parts[0].size).toBe(FALLBACK_PART_SIZE);
    const rest = await sendParts(up, bytes, [2]);
    await sendDerivatives(up.uploadId);
    const parts = [...st.body.parts.map((p: any) => ({ partNumber: p.partNumber, etag: p.etag })), ...rest];
    const c = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/complete`, { cookie: admin, now: NOW, body: { parts } });
    expect(c.body.verified).toBe(true);
  });

  it('ハッシュが合わなければ、アルバムに入れず hash_mismatch_at を入れる', async () => {
    const a = await insertAlbum();
    const bytes = jpeg(4000);
    const s = await start(a, bytes, { sha256: 'f'.repeat(64) });
    const up = s.body as Started;
    const parts = await sendParts(up, bytes);
    await sendDerivatives(up.uploadId);
    const c = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/complete`, { cookie: admin, now: NOW, body: { parts } });
    expect(c.body).toEqual({ photoId: up.photoId, verified: false });
    const photo = await env.DB.prepare('SELECT status, hash_mismatch_at FROM photos WHERE id = ?').bind(up.photoId).first<any>();
    expect(photo).toEqual({ status: 'failed', hash_mismatch_at: NOW });
    expect(await env.DB.prepare('SELECT 1 FROM album_photos WHERE photo_id = ?').bind(up.photoId).first()).toBeNull();
    expect((await lastAudit('photo.hash_mismatch')).target_id).toBe(String(up.photoId));
  });

  it('プレビューが届いていなければ、完了できない(409)。部分が足りなくても 409', async () => {
    const a = await insertAlbum();
    const bytes = jpeg(FALLBACK_PART_SIZE + 10);
    const up = (await start(a, bytes)).body as Started;
    const parts = await sendParts(up, bytes);
    await sendDerivatives(up.uploadId, ['preview', 'thumb']);
    const c = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/complete`, { cookie: admin, body: { parts } });
    expect(c.status).toBe(409);
    expect(c.body.error.details.missing).toEqual(['view']);
    await sendDerivatives(up.uploadId, ['view']);
    const short = await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/complete`, { cookie: admin, body: { parts: parts.slice(0, 1) } });
    expect(short.status).toBe(409);
    expect((await adminCall<any>(`/admin/api/photos/uploads/${up.uploadId}/complete`, { cookie: admin, body: { parts } })).body.verified).toBe(true);
  });

  it('やめる: 途中のファイルを消し、行は残す(失敗の印)', async () => {
    const a = await insertAlbum();
    const bytes = jpeg(3000);
    const up = (await start(a, bytes)).body as Started;
    await sendParts(up, bytes);
    const r = await adminCall(`/admin/api/photos/uploads/${up.uploadId}`, { cookie: admin, method: 'DELETE' });
    expect(r.status).toBe(204);
    const row = await env.DB.prepare('SELECT u.status AS us, p.status AS ps FROM photo_uploads u JOIN photos p ON p.id = u.photo_id WHERE u.id = ?').bind(up.uploadId).first<any>();
    expect(row).toEqual({ us: 'aborted', ps: 'failed' });
    const list = await env.MEDIA.list({ prefix: 'photo-sales/originals/' });
    expect(list.objects).toHaveLength(0);
    // やめたあとに部分を送っても受け取らない
    expect((await adminCall(`/admin/api/photos/uploads/${up.uploadId}/parts`, { cookie: admin, body: { partNumbers: [1] } })).status).toBe(409);
  });

  it('並び順はファイル名の順(届いた順ではない)。公開中の写真の並びは動かさない', async () => {
    const a = await insertAlbum();
    const pub = await insertPhoto(a, { status: 'published', filename: 'ZZZ.JPG', sortOrder: 1 });
    const r10 = await uploadOne(a, jpeg(2010), 'IMG_10.JPG');
    const r2 = await uploadOne(a, jpeg(2002), 'IMG_2.JPG');
    const r1 = await uploadOne(a, jpeg(2001), 'IMG_1.JPG');
    const d = await adminCall<any>(`/admin/api/photos/albums/${a}`, { cookie: admin });
    expect(d.body.photos.map((p: any) => p.photoId)).toEqual([pub, r1.up.photoId, r2.up.photoId, r10.up.photoId]);
  });

  it('アップロードは操作ログから元に戻せる(下書きのあいだはアルバムから外す)', async () => {
    const a = await insertAlbum();
    const { up } = await uploadOne(a, jpeg(2222));
    const log = await lastAudit('photo.upload');
    expect((await undo(admin, log.id)).status).toBe(200);
    const ap = await env.DB.prepare('SELECT status FROM album_photos WHERE photo_id = ?').bind(up.photoId).first<any>();
    expect(ap.status).toBe('removed');
  });

  it('JPEG と HEIC だけ。外したアルバム・販売終了のアルバムには送れない', async () => {
    const a = await insertAlbum();
    const png = await adminCall(`/admin/api/photos/albums/${a}/uploads`, {
      cookie: admin,
      body: { filename: 'a.png', bytes: 10, contentType: 'image/png', sha256: 'a'.repeat(64) },
    });
    expect(png.status).toBe(400);
    expect(png.body.error.message).toBe('JPEG か HEIC の写真だけを送れます。');
    const ended = await insertAlbum({ status: 'ended' });
    expect((await start(ended, jpeg(10))).status).toBe(409);
    await env.DB.prepare('UPDATE albums SET removed_at = ? WHERE id = ?').bind(NOW, a).run();
    expect((await start(a, jpeg(10))).status).toBe(409);
  });

  it('受付・製作者は 403(何も作られない)', async () => {
    const a = await insertAlbum();
    expect((await start(a, jpeg(10), { cookie: developer })).status).toBe(403);
    expect((await start(a, jpeg(10), { cookie: staff })).status).toBe(403);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM photo_uploads').first<any>()).n).toBe(0);
  });
});

describe('アップロード(R2 の送り先)', () => {
  /** R2 の S3 API のまね(マルチパートを始める・部分の一覧・完了) */
  function fakeR2() {
    const calls: { method: string; url: string }[] = [];
    const objects = new Map<string, Uint8Array>();
    const bucket = {
      async head(key: string) {
        const o = objects.get(key);
        return o ? { size: o.byteLength, httpMetadata: { contentType: 'image/jpeg' } } : null;
      },
      async get(key: string) {
        const o = objects.get(key);
        return o ? { body: new Blob([o]).stream(), size: o.byteLength, httpMetadata: { contentType: 'image/jpeg' } } : null;
      },
      async put(key: string, body: Uint8Array) {
        objects.set(key, body);
      },
      async delete() {},
    } as unknown as R2Bucket;
    const fetcher = (async (req: Request) => {
      calls.push({ method: req.method, url: req.url });
      const u = new URL(req.url);
      if (req.method === 'POST' && u.searchParams.has('uploads')) return new Response('<InitiateMultipartUploadResult><UploadId>mp-123</UploadId></InitiateMultipartUploadResult>');
      if (req.method === 'POST' && u.searchParams.get('uploadId')) return new Response('<CompleteMultipartUploadResult></CompleteMultipartUploadResult>');
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const storage = new R2PhotoStorage(
      { endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'photos', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'auto', bucketBinding: bucket },
      fetcher,
    );
    return { storage, calls, objects };
  }

  it('原本の部分は R2 の署名つき URL(ブラウザから直接)、プレビューは Content-Type を固定した署名つき URL', async () => {
    const { storage, calls, objects } = fakeR2();
    const a = await insertAlbum();
    const bytes = jpeg(100);
    const ctx = { staffId: 1, now: new Date('2026-11-03T01:00:00Z'), origin: 'https://dogrun.test' };
    const s = await startUpload(env.DB, storage, a, { filename: 'IMG.JPG', bytes: 20 * 1024 * 1024, contentType: 'image/jpeg', sha256: await sha256Hex(bytes) }, ctx);
    if (s.duplicate) throw new Error('duplicate');
    expect(s).toMatchObject({ storage: 'r2', partSize: 8 * 1024 * 1024, partCount: 3 });
    expect(calls[0]).toMatchObject({ method: 'POST' });
    const row = await env.DB.prepare('SELECT multipart_upload_id, storage FROM photo_uploads WHERE id = ?').bind(s.uploadId).first<any>();
    expect(row).toEqual({ multipart_upload_id: 'mp-123', storage: 'r2' });
    const t = await partTargets(env.DB, storage, s.uploadId, [2, 1], ctx);
    expect(t.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    const u = new URL(t.parts[0]!.url);
    expect(u.origin).toBe('https://acc.r2.cloudflarestorage.com');
    expect(u.pathname).toMatch(/^\/photos\/originals\//);
    expect(u.searchParams.get('partNumber')).toBe('1');
    expect(u.searchParams.get('uploadId')).toBe('mp-123');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(t.parts[0]!.headers).toEqual({});
    const d = await derivativeTarget(env.DB, storage, s.uploadId, 'preview', ctx);
    expect(new URL(d.url).searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(d.headers).toEqual({ 'content-type': 'image/jpeg' });
    // 範囲の外の部分は 400
    await expect(partTargets(env.DB, storage, s.uploadId, [4], ctx)).rejects.toThrow();
    // 完了: R2 の完了を呼び、バインディングで読んだ SHA-256 を比べる
    const p = await env.DB.prepare('SELECT p.original_key, p.preview_key, p.thumb_key, p.view_key FROM photo_uploads u JOIN photos p ON p.id = u.photo_id WHERE u.id = ?').bind(s.uploadId).first<any>();
    objects.set(p.original_key, bytes);
    for (const k of [p.preview_key, p.thumb_key, p.view_key]) objects.set(k, jpeg(10));
    await env.DB.prepare('UPDATE photos SET bytes = ? WHERE id = ?').bind(bytes.byteLength, s.photoId).run();
    const c = await completeUpload(env.DB, storage, s.uploadId, [1, 2, 3].map((n) => ({ partNumber: n, etag: `"e${n}"` })), ctx);
    expect(c).toEqual({ photoId: s.photoId, verified: true });
    expect(calls.at(-1)).toMatchObject({ method: 'POST' });
    expect(new URL(calls.at(-1)!.url).searchParams.get('uploadId')).toBe('mp-123');
  });
});
