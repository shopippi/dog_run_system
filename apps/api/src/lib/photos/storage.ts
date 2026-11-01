import {
  FALLBACK_PART_SIZE,
  PHOTO_DOWNLOAD_TTL_SECONDS,
  PHOTO_FALLBACK_PREFIX,
  R2_PART_SIZE,
  toHex,
  toJstIso,
  type PhotoDerivative,
  type UploadTarget,
} from '@dr/shared';
import type { Bindings } from '../../env';
import { signFileToken } from './file-token';
import {
  completeMultipartXml,
  contentDisposition,
  objectUrl,
  presignUrl,
  signedRequest,
  xmlBlocks,
  xmlValue,
  type S3Target,
} from './s3';

// 写真販売のファイルの置き場所(docs/photo-requirements.md 7章)。2つの実装を同じ形で使う:
// (a) R2: 原本は管理者のブラウザから R2 へ署名つき URL でマルチパートのまま直接送る。購入者も 5分の署名つき URL で R2 から直接受け取る。
// (b) 代わりの置き場所(local・test・デモ): Worker を通して小分けに送り、写真の保存先(env.MEDIA。R2 か D1 の media_objects)に入れる。
//     受け取りは、Worker の短い期限の URL(/api/photos/files/<署名>)。
// 本番で R2 の設定がないときは、どちらも使わない(photoStorage が null → 「準備中」)。
// 原本は一度もデコード・再エンコードしない(バイトのまま運ぶ)。

export type StorageKind = 'r2' | 'fallback';
export type StoredFile = { body: ReadableStream; size: number; contentType: string | null };
export type PartInfo = { partNumber: number; etag: string; size: number };

export interface PhotoStorage {
  readonly kind: StorageKind;
  /** マルチパートの1つの大きさ(最後以外) */
  readonly partSize: number;
  /** 原本のマルチパートを始める。返すのは置き場所の upload ID(代わりの置き場所では null) */
  createMultipart(key: string, contentType: string, now: Date): Promise<string | null>;
  /** 部分の送り先(R2 は署名つき URL、代わりの置き場所は Worker の URL) */
  partTarget(args: { key: string; uploadId: string; multipartId: string | null; partNumber: number; origin: string; now: Date }): Promise<UploadTarget>;
  /** 送り終えた部分(続きから送るため) */
  listParts(key: string, multipartId: string | null, now: Date): Promise<PartInfo[]>;
  completeMultipart(key: string, multipartId: string | null, parts: { partNumber: number; etag: string }[], contentType: string, now: Date): Promise<void>;
  abortMultipart(key: string, multipartId: string | null, now: Date): Promise<void>;
  /** プレビュー・サムネイル・中サイズ(1回で送る)の送り先 */
  putTarget(args: { key: string; contentType: string; uploadId: string; kind: PhotoDerivative; origin: string; now: Date }): Promise<UploadTarget>;
  /** Worker の中から書く(代わりの置き場所の受け取り口・デモの初期データ) */
  put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  /** 代わりの置き場所だけ: 部分を受け取る */
  putPart?(key: string, partNumber: number, body: ArrayBuffer): Promise<{ etag: string }>;
  get(key: string): Promise<StoredFile | null>;
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  /** バイトのままコピーする(購入済み領域へ) */
  copy(srcKey: string, dstKey: string, now: Date): Promise<void>;
  /** ファイルを消す(販売終了の売れなかった写真・途中でやめたアップロードだけ) */
  delete(keys: string[], now: Date): Promise<void>;
  /** 購入者が受け取る URL(5分) */
  downloadUrl(args: { key: string; filename: string; contentType: string; origin: string; now: Date; expiresIn?: number }): Promise<{ url: string; expiresAt: string }>;
  /** サーバーで SHA-256 を計算する(アップロード後・コピー後の確かめ) */
  sha256(key: string): Promise<string | null>;
}

// ---------------------------------------------------------------- キー

export type PhotoKeyArea = 'originals' | 'purchased' | 'view' | 'preview' | 'thumb';

/** 推測できないキー: <場所>/<ランダム>/<ランダム>.<拡張子>。元のファイル名は含めない */
export function newPhotoKey(area: PhotoKeyArea, contentType: string): string {
  const ext = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/heic' ? 'heic' : contentType === 'image/heif' ? 'heif' : 'bin';
  return `${area}/${crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
}

// ---------------------------------------------------------------- SHA-256(流しながら)

type DigestStreamCtor = new (algorithm: string) => WritableStream<ArrayBufferView> & { digest: Promise<ArrayBuffer> };

/** 流れてくるバイトの SHA-256。Workers の DigestStream があれば使い(大きな原本でもメモリを使わない)、無ければ全部読んで計算する */
export async function sha256OfStream(stream: ReadableStream): Promise<string> {
  const DS = (crypto as unknown as { DigestStream?: DigestStreamCtor }).DigestStream;
  if (DS) {
    const ds = new DS('SHA-256');
    await stream.pipeTo(ds);
    return toHex(await ds.digest);
  }
  const buf = await new Response(stream).arrayBuffer();
  return toHex(await crypto.subtle.digest('SHA-256', buf));
}

// ---------------------------------------------------------------- (a) R2

export type R2Config = S3Target & { bucketBinding: R2Bucket };

/** R2 の設定がそろっているか(バインディング・アカウントID・鍵・バケットの名前) */
export function r2Config(env: Partial<Bindings>): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.PHOTOS_BUCKET_NAME?.trim();
  if (!env.PHOTOS || !accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: 'auto',
    bucketBinding: env.PHOTOS,
  };
}

export class R2PhotoStorage implements PhotoStorage {
  readonly kind = 'r2' as const;
  readonly partSize = R2_PART_SIZE;
  constructor(
    private readonly cfg: R2Config,
    private readonly fetcher: typeof fetch = (req, init) => fetch(req, init),
  ) {}

  private get creds() {
    return { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey };
  }

  private async call(method: string, key: string, now: Date, query: Record<string, string>, opts: { headers?: Record<string, string>; body?: string } = {}) {
    const req = await signedRequest({ credentials: this.creds, url: objectUrl(this.cfg, key, query), method, now, headers: opts.headers, body: opts.body });
    const res = await this.fetcher(req);
    const text = await res.text();
    if (!res.ok) throw new Error(`R2 ${method} ${res.status}: ${text.slice(0, 300)}`);
    return text;
  }

  async createMultipart(key: string, contentType: string, now: Date) {
    const xml = await this.call('POST', key, now, { uploads: '' }, { headers: { 'content-type': contentType } });
    const id = xmlValue(xml, 'UploadId');
    if (!id) throw new Error('R2 のマルチパートを始められませんでした(UploadId がない)');
    return id;
  }

  async partTarget(args: { key: string; multipartId: string | null; partNumber: number; now: Date }): Promise<UploadTarget> {
    const expiresIn = 3600;
    const url = await presignUrl({
      credentials: this.creds,
      url: objectUrl(this.cfg, args.key, { partNumber: String(args.partNumber), uploadId: args.multipartId ?? '' }),
      method: 'PUT',
      expiresIn,
      now: args.now,
    });
    return { url, method: 'PUT', headers: {}, expiresAt: toJstIso(new Date(args.now.getTime() + expiresIn * 1000)) };
  }

  async listParts(key: string, multipartId: string | null, now: Date): Promise<PartInfo[]> {
    const xml = await this.call('GET', key, now, { uploadId: multipartId ?? '' });
    return xmlBlocks(xml, 'Part').map((p) => ({
      partNumber: Number(xmlValue(p, 'PartNumber')),
      etag: xmlValue(p, 'ETag') ?? '',
      size: Number(xmlValue(p, 'Size') ?? 0),
    }));
  }

  async completeMultipart(key: string, multipartId: string | null, parts: { partNumber: number; etag: string }[], _ct: string, now: Date) {
    const xml = await this.call('POST', key, now, { uploadId: multipartId ?? '' }, { body: completeMultipartXml(parts), headers: { 'content-type': 'application/xml' } });
    // S3 は 200 のまま本文にエラーを返すことがある
    if (xml.includes('<Error>')) throw new Error(`R2 のマルチパートを完了できませんでした: ${xml.slice(0, 300)}`);
  }

  async abortMultipart(key: string, multipartId: string | null, now: Date) {
    await this.call('DELETE', key, now, { uploadId: multipartId ?? '' });
  }

  async putTarget(args: { key: string; contentType: string; now: Date }): Promise<UploadTarget> {
    const expiresIn = 3600;
    const headers = { 'content-type': args.contentType };
    const url = await presignUrl({ credentials: this.creds, url: objectUrl(this.cfg, args.key), method: 'PUT', expiresIn, now: args.now, headers });
    return { url, method: 'PUT', headers, expiresAt: toJstIso(new Date(args.now.getTime() + expiresIn * 1000)) };
  }

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string) {
    await this.cfg.bucketBinding.put(key, body, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<StoredFile | null> {
    const o = await this.cfg.bucketBinding.get(key);
    if (!o) return null;
    return { body: o.body, size: o.size, contentType: o.httpMetadata?.contentType ?? null };
  }

  async head(key: string) {
    const o = await this.cfg.bucketBinding.head(key);
    return o ? { size: o.size, contentType: o.httpMetadata?.contentType ?? null } : null;
  }

  async copy(srcKey: string, dstKey: string, now: Date) {
    // サーバーの中でのコピー(CopyObject)。バイトはそのまま
    const xml = await this.call('PUT', dstKey, now, {}, { headers: { 'x-amz-copy-source': `/${this.cfg.bucket}/${srcKey.split('/').map(encodeURIComponent).join('/')}` } });
    if (xml.includes('<Error>')) throw new Error(`R2 でコピーできませんでした: ${xml.slice(0, 300)}`);
  }

  async delete(keys: string[]) {
    if (keys.length) await this.cfg.bucketBinding.delete(keys);
  }

  async downloadUrl(args: { key: string; filename: string; contentType: string; now: Date; expiresIn?: number }) {
    const expiresIn = args.expiresIn ?? PHOTO_DOWNLOAD_TTL_SECONDS;
    const url = await presignUrl({
      credentials: this.creds,
      url: objectUrl(this.cfg, args.key, {
        'response-content-disposition': contentDisposition(args.filename),
        'response-content-type': args.contentType,
      }),
      method: 'GET',
      expiresIn,
      now: args.now,
    });
    return { url, expiresAt: toJstIso(new Date(args.now.getTime() + expiresIn * 1000)) };
  }

  async sha256(key: string) {
    const o = await this.cfg.bucketBinding.get(key);
    return o ? sha256OfStream(o.body) : null;
  }
}

// ---------------------------------------------------------------- (b) 代わりの置き場所(local・test・デモ)

/** 小分けに保存した原本の目次(キーの場所に置く) */
export const CHUNKED_CONTENT_TYPE = 'application/vnd.dr-chunked+json';
type Manifest = { v: 1; size: number; contentType: string; parts: { key: string; size: number }[] };
const partKey = (key: string, n: number) => `${key}#part-${String(n).padStart(5, '0')}`;
/** ほかの写真(犬の写真など)と分けるため、写真販売のファイルには頭に付ける */
export const FALLBACK_PREFIX = PHOTO_FALLBACK_PREFIX;

/** 代わりの置き場所の受け取り口の、署名の秘密(本番では使わない) */
export function fileTokenSecret(env: Pick<Bindings, 'PHOTO_URL_SECRET' | 'ENVIRONMENT'>): string | null {
  const s = env.PHOTO_URL_SECRET?.trim();
  if (s) return s;
  return env.ENVIRONMENT === 'production' ? null : 'dr-local-photo-url-secret';
}

export class FallbackPhotoStorage implements PhotoStorage {
  readonly kind = 'fallback' as const;
  readonly partSize = FALLBACK_PART_SIZE;
  constructor(
    private readonly bucket: R2Bucket,
    private readonly secret: string,
  ) {}

  private k(key: string) {
    return FALLBACK_PREFIX + key;
  }

  private async manifest(key: string): Promise<Manifest | null> {
    const o = await this.bucket.get(this.k(key));
    if (!o || o.httpMetadata?.contentType !== CHUNKED_CONTENT_TYPE) return null;
    return (await o.json()) as Manifest;
  }

  async createMultipart(_key: string, _contentType: string, _now: Date): Promise<string | null> {
    return null;
  }

  async partTarget(args: { uploadId: string; partNumber: number; origin: string; now: Date }): Promise<UploadTarget> {
    return {
      url: `${args.origin}/admin/api/photos/uploads/${encodeURIComponent(args.uploadId)}/parts/${args.partNumber}`,
      method: 'PUT',
      headers: { 'x-dr-admin': '1', 'content-type': 'application/octet-stream' },
      expiresAt: toJstIso(new Date(args.now.getTime() + 3600_000)),
    };
  }

  async putPart(key: string, partNumber: number, body: ArrayBuffer) {
    await this.bucket.put(this.k(partKey(key, partNumber)), body, { httpMetadata: { contentType: 'application/octet-stream' } });
    const etag = toHex(await crypto.subtle.digest('SHA-256', body)).slice(0, 32);
    return { etag: `"${etag}"` };
  }

  async listParts(key: string): Promise<PartInfo[]> {
    const prefix = this.k(`${key}#part-`);
    const out: PartInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor });
      for (const o of page.objects) out.push({ partNumber: Number(o.key.slice(prefix.length)), etag: o.etag, size: o.size });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipart(key: string, _id: string | null, parts: { partNumber: number }[], contentType: string) {
    const stored = new Map((await this.listParts(key)).map((p) => [p.partNumber, p]));
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const list = sorted.map((p, i) => {
      const s = stored.get(p.partNumber);
      if (!s || p.partNumber !== i + 1) throw new Error(`部分 ${p.partNumber} が届いていません`);
      return { key: partKey(key, p.partNumber), size: s.size };
    });
    const manifest: Manifest = { v: 1, size: list.reduce((n, p) => n + p.size, 0), contentType, parts: list };
    await this.bucket.put(this.k(key), JSON.stringify(manifest), { httpMetadata: { contentType: CHUNKED_CONTENT_TYPE } });
  }

  async abortMultipart(key: string) {
    const parts = await this.listParts(key);
    if (parts.length) await this.bucket.delete(parts.map((p) => this.k(partKey(key, p.partNumber))));
  }

  async putTarget(args: { uploadId: string; kind: PhotoDerivative; contentType: string; origin: string; now: Date }): Promise<UploadTarget> {
    return {
      url: `${args.origin}/admin/api/photos/uploads/${encodeURIComponent(args.uploadId)}/derivatives/${args.kind}`,
      method: 'PUT',
      headers: { 'x-dr-admin': '1', 'content-type': args.contentType },
      expiresAt: toJstIso(new Date(args.now.getTime() + 3600_000)),
    };
  }

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string) {
    await this.bucket.put(this.k(key), body, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<StoredFile | null> {
    const o = await this.bucket.get(this.k(key));
    if (!o) return null;
    if (o.httpMetadata?.contentType !== CHUNKED_CONTENT_TYPE) {
      return { body: o.body, size: o.size, contentType: o.httpMetadata?.contentType ?? null };
    }
    const m = (await o.json()) as Manifest;
    const bucket = this.bucket;
    const prefix = FALLBACK_PREFIX;
    let i = 0;
    // 部分を順に読み、そのままつなげて流す(デコードしない)
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (i >= m.parts.length) {
          controller.close();
          return;
        }
        const part = await bucket.get(prefix + m.parts[i++]!.key);
        if (!part) {
          controller.error(new Error('原本の一部が見つかりません'));
          return;
        }
        controller.enqueue(new Uint8Array(await part.arrayBuffer()));
      },
    });
    return { body, size: m.size, contentType: m.contentType };
  }

  async head(key: string) {
    const m = await this.manifest(key);
    if (m) return { size: m.size, contentType: m.contentType };
    const o = await this.bucket.head(this.k(key));
    return o ? { size: o.size, contentType: o.httpMetadata?.contentType ?? null } : null;
  }

  async copy(srcKey: string, dstKey: string) {
    const m = await this.manifest(srcKey);
    if (!m) {
      const o = await this.bucket.get(this.k(srcKey));
      if (!o) throw new Error('コピーする写真が見つかりません');
      await this.bucket.put(this.k(dstKey), await o.arrayBuffer(), { httpMetadata: { contentType: o.httpMetadata?.contentType ?? 'application/octet-stream' } });
      return;
    }
    const parts: Manifest['parts'] = [];
    for (let n = 0; n < m.parts.length; n++) {
      const p = await this.bucket.get(FALLBACK_PREFIX + m.parts[n]!.key);
      if (!p) throw new Error('コピーする写真の一部が見つかりません');
      const key = partKey(dstKey, n + 1);
      await this.bucket.put(this.k(key), await p.arrayBuffer(), { httpMetadata: { contentType: 'application/octet-stream' } });
      parts.push({ key, size: m.parts[n]!.size });
    }
    await this.bucket.put(this.k(dstKey), JSON.stringify({ ...m, parts }), { httpMetadata: { contentType: CHUNKED_CONTENT_TYPE } });
  }

  async delete(keys: string[]) {
    const all: string[] = [];
    for (const key of keys) {
      const m = await this.manifest(key);
      if (m) all.push(...m.parts.map((p) => FALLBACK_PREFIX + p.key));
      all.push(this.k(key));
    }
    if (all.length) await this.bucket.delete(all);
  }

  async downloadUrl(args: { key: string; filename: string; contentType: string; origin: string; now: Date; expiresIn?: number }) {
    const expiresIn = args.expiresIn ?? PHOTO_DOWNLOAD_TTL_SECONDS;
    const e = Math.floor(args.now.getTime() / 1000) + expiresIn;
    const token = await signFileToken(this.secret, { e, k: args.key, f: args.filename, t: args.contentType });
    return { url: `${args.origin}/api/photos/files/${token}`, expiresAt: toJstIso(new Date(e * 1000)) };
  }

  async sha256(key: string) {
    const f = await this.get(key);
    return f ? sha256OfStream(f.body) : null;
  }
}

// ---------------------------------------------------------------- 選ぶ

/**
 * 写真の置き場所を決める。R2 の設定がそろっていれば R2。なければ、local・test(とデモ)は代わりの置き場所。
 * 本番で R2 の設定がないときは null(写真販売は「準備中」)
 */
export function photoStorage(env: Bindings): PhotoStorage | null {
  const r2 = r2Config(env);
  if (r2) return new R2PhotoStorage(r2);
  if (env.ENVIRONMENT === 'production') return null;
  const secret = fileTokenSecret(env);
  if (!secret || !env.MEDIA) return null;
  return new FallbackPhotoStorage(env.MEDIA, secret);
}
