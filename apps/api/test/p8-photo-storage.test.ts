import { SELF, env } from 'cloudflare:test';
import { sha256Hex } from '@dr/shared';
import { describe, expect, it } from 'vitest';
import { signFileToken, verifyFileToken } from '../src/lib/photos/file-token';
import { completeMultipartXml, contentDisposition, encodeKey, presignUrl, xmlBlocks, xmlValue } from '../src/lib/photos/s3';
import { FallbackPhotoStorage, R2PhotoStorage, newPhotoKey, photoStorage, r2Config, sha256OfStream } from '../src/lib/photos/storage';
import { BASE } from './helpers';

// 写真販売の置き場所(docs/photo-requirements.md 7章)。署名(SigV4)・R2 の実装(fetch のまね)・代わりの置き場所

const NOW = new Date('2026-11-03T01:00:00Z');

/** 決まった中身のバイト列(大きさを変えて、部分に分かれるように) */
function bytesOf(n: number, seed = 7): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe('署名つき URL(SigV4・aws4fetch)', () => {
  it('AWS の公式の例と同じ署名になる(GET・24時間)', async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html の例
    const url = await presignUrl({
      credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      method: 'GET',
      expiresIn: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
      region: 'us-east-1',
    });
    const u = new URL(url);
    expect(u.searchParams.get('X-Amz-Signature')).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
    expect(u.searchParams.get('X-Amz-Credential')).toBe('AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request');
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('Content-Type を固定するときは、署名に含める', async () => {
    const url = await presignUrl({
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      url: 'https://acc.r2.cloudflarestorage.com/b/preview/x.jpg',
      method: 'PUT',
      expiresIn: 3600,
      now: NOW,
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
  });

  it('キーは / を残して1つずつ符号化する。ファイル名は日本語も入れられる', () => {
    expect(encodeKey("originals/a b/c'd.jpg")).toBe('originals/a%20b/c%27d.jpg');
    expect(contentDisposition('運動会_01.jpg')).toBe(`attachment; filename="____01.jpg"; filename*=UTF-8''${encodeURIComponent('運動会_01.jpg')}`);
  });

  it('XML の読み書き', () => {
    expect(xmlValue('<a><UploadId>x&amp;y</UploadId></a>', 'UploadId')).toBe('x&y');
    expect(xmlBlocks('<Part><N>1</N></Part><Part><N>2</N></Part>', 'Part')).toEqual(['<N>1</N>', '<N>2</N>']);
    expect(completeMultipartXml([{ partNumber: 2, etag: '"b"' }, { partNumber: 1, etag: '"a"' }])).toBe(
      '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;a&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;b&quot;</ETag></Part></CompleteMultipartUpload>',
    );
  });
});

describe('R2 の実装(fetch のまね。R2 は呼ばない)', () => {
  const cfg = {
    endpoint: 'https://acc123.r2.cloudflarestorage.com',
    bucket: 'photos',
    accessKeyId: 'AKTEST',
    secretAccessKey: 'SKTEST',
    region: 'auto',
    bucketBinding: env.MEDIA,
  };

  it('マルチパートを始める・部分の URL・完了・一覧は、署名した S3 の要求になる', async () => {
    const seen: Request[] = [];
    const fetcher = (async (req: Request) => {
      seen.push(req);
      const u = new URL(req.url);
      if (req.method === 'POST' && u.searchParams.has('uploads')) {
        return new Response('<InitiateMultipartUploadResult><UploadId>UP-1</UploadId></InitiateMultipartUploadResult>');
      }
      if (req.method === 'GET') {
        return new Response('<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>"e1"</ETag><Size>8388608</Size></Part></ListPartsResult>');
      }
      return new Response('<CompleteMultipartUploadResult></CompleteMultipartUploadResult>');
    }) as unknown as typeof fetch;
    const s = new R2PhotoStorage(cfg, fetcher);

    expect(await s.createMultipart('originals/u/v.jpg', 'image/jpeg', NOW)).toBe('UP-1');
    expect(seen[0]!.url).toBe('https://acc123.r2.cloudflarestorage.com/photos/originals/u/v.jpg?uploads=');
    expect(seen[0]!.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKTEST\/20261103\/auto\/s3\/aws4_request/);

    const part = await s.partTarget({ key: 'originals/u/v.jpg', multipartId: 'UP-1', partNumber: 3, now: NOW });
    const pu = new URL(part.url);
    expect(pu.searchParams.get('partNumber')).toBe('3');
    expect(pu.searchParams.get('uploadId')).toBe('UP-1');
    expect(pu.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(pu.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

    expect(await s.listParts('originals/u/v.jpg', 'UP-1', NOW)).toEqual([{ partNumber: 1, etag: '"e1"', size: 8388608 }]);
    await s.completeMultipart('originals/u/v.jpg', 'UP-1', [{ partNumber: 1, etag: '"e1"' }], 'image/jpeg', NOW);
    const complete = seen.at(-1)!;
    expect(complete.method).toBe('POST');
    expect(new URL(complete.url).searchParams.get('uploadId')).toBe('UP-1');
    expect(await complete.text()).toContain('<PartNumber>1</PartNumber>');
  });

  it('ダウンロードの URL は5分で、ファイル名を付ける', async () => {
    const s = new R2PhotoStorage(cfg, (() => {
      throw new Error('呼ばない');
    }) as unknown as typeof fetch);
    const { url, expiresAt } = await s.downloadUrl({ key: 'purchased/a/b.jpg', filename: 'IMG_0001.JPG', contentType: 'image/jpeg', now: NOW });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://acc123.r2.cloudflarestorage.com/photos/purchased/a/b.jpg');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(u.searchParams.get('response-content-disposition')).toContain('IMG_0001.JPG');
    expect(expiresAt).toBe('2026-11-03T10:05:00+09:00');
  });

  it('R2 の設定がそろっていないときは使わない(local・test は代わりの置き場所)', () => {
    expect(r2Config({ PHOTOS: env.MEDIA, R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: '' , PHOTOS_BUCKET_NAME: 'b' })).toBeNull();
    expect(r2Config({ PHOTOS: env.MEDIA, R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', PHOTOS_BUCKET_NAME: 'b' })).not.toBeNull();
    expect(photoStorage(env)?.kind).toBe('fallback');
    expect(photoStorage({ ...env, ENVIRONMENT: 'production' })).toBeNull();
  });

  it('キーは推測できない(元のファイル名を含めない)', () => {
    const a = newPhotoKey('originals', 'image/jpeg');
    expect(a).toMatch(/^originals\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
    expect(newPhotoKey('originals', 'image/jpeg')).not.toBe(a);
    expect(newPhotoKey('purchased', 'image/heic')).toMatch(/\.heic$/);
  });
});

describe('代わりの置き場所(local・test・デモ)', () => {
  const secret = 'test-secret';
  const storage = () => new FallbackPhotoStorage(env.MEDIA, secret);

  it('原本を部分に分けて送り、つなげるとバイト単位で同じ。SHA-256 も同じ', async () => {
    const s = storage();
    const original = bytesOf(s.partSize * 2 + 12345);
    const key = newPhotoKey('originals', 'image/jpeg');
    expect(await s.createMultipart(key, 'image/jpeg', NOW)).toBeNull();
    const parts = [] as { partNumber: number; etag: string }[];
    for (let n = 1, off = 0; off < original.length; n++, off += s.partSize) {
      const chunk = original.slice(off, off + s.partSize);
      const { etag } = await s.putPart!(key, n, chunk.buffer);
      parts.push({ partNumber: n, etag });
    }
    expect((await s.listParts(key)).map((p) => p.partNumber)).toEqual([1, 2, 3]);
    await s.completeMultipart(key, null, parts, 'image/jpeg');

    expect(await s.head(key)).toEqual({ size: original.length, contentType: 'image/jpeg' });
    const got = await s.get(key);
    const back = new Uint8Array(await new Response(got!.body).arrayBuffer());
    expect(back.length).toBe(original.length);
    expect(Buffer.compare(Buffer.from(back), Buffer.from(original))).toBe(0);
    expect(await s.sha256(key)).toBe(await sha256Hex(original));

    // 購入済み領域へのコピーもバイト単位で同じ。元を消しても残る
    const dst = newPhotoKey('purchased', 'image/jpeg');
    await s.copy(key, dst);
    expect(await s.sha256(dst)).toBe(await sha256Hex(original));
    await s.delete([key]);
    expect(await s.get(key)).toBeNull();
    expect(await s.sha256(dst)).toBe(await sha256Hex(original));
  });

  it('届いていない部分があると完了できない', async () => {
    const s = storage();
    const key = newPhotoKey('originals', 'image/jpeg');
    await s.putPart!(key, 1, bytesOf(10).buffer);
    await expect(s.completeMultipart(key, null, [{ partNumber: 1 }, { partNumber: 2 }], 'image/jpeg')).rejects.toThrow();
    await s.abortMultipart(key);
    expect(await s.listParts(key)).toEqual([]);
  });

  it('ダウンロードの URL(5分の署名)で、原本をそのまま受け取れる。期限が切れたら 410', async () => {
    const s = new FallbackPhotoStorage(env.MEDIA, 'dr-local-photo-url-secret');
    const original = bytesOf(3000, 3);
    const key = newPhotoKey('purchased', 'image/jpeg');
    await s.put(key, original, 'image/jpeg');
    const { url, expiresAt } = await s.downloadUrl({ key, filename: '運動会.jpg', contentType: 'image/jpeg', origin: BASE, now: NOW });
    expect(expiresAt).toBe('2026-11-03T10:05:00+09:00');
    const res = await SELF.fetch(url, { headers: { 'x-debug-now': '2026-11-03T10:04:00+09:00' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(encodeURIComponent('運動会.jpg'));
    expect(await sha256Hex(await res.arrayBuffer())).toBe(await sha256Hex(original));

    const late = await SELF.fetch(url, { headers: { 'x-debug-now': '2026-11-03T10:05:01+09:00' } });
    expect(late.status).toBe(410);
    const tampered = await SELF.fetch(url.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), { headers: { 'x-debug-now': '2026-11-03T10:04:00+09:00' } });
    expect(tampered.status).toBe(410);
  });

  it('流しながらの SHA-256', async () => {
    const b = bytesOf(100_000);
    expect(await sha256OfStream(new Blob([b]).stream())).toBe(await sha256Hex(b));
  });
});

describe('受け取り口の署名(HMAC)', () => {
  it('署名が合い、期限内のときだけ中身を返す', async () => {
    const token = await signFileToken('s', { e: Math.floor(NOW.getTime() / 1000) + 300, k: 'a/b.jpg' });
    expect(await verifyFileToken('s', token, NOW)).toMatchObject({ k: 'a/b.jpg' });
    expect(await verifyFileToken('other', token, NOW)).toBeNull();
    expect(await verifyFileToken('s', token, new Date(NOW.getTime() + 300_000))).toBeNull();
    expect(await verifyFileToken('s', `${token}.x`, NOW)).toBeNull();
    expect(await verifyFileToken('s', 'garbage', NOW)).toBeNull();
  });
});
