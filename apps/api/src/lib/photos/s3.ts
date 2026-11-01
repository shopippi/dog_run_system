import { AwsV4Signer } from 'aws4fetch';

// R2 の S3 互換 API の署名(AWS Signature Version 4)。aws4fetch(MIT)を使う。
// - 管理者のブラウザから R2 へ直接送る URL(UploadPart・PutObject)と、購入者が R2 から直接受け取る URL(GetObject・5分)を作る
// - サーバーから呼ぶ操作(マルチパートの開始・完了・中止・一覧、コピー)は、署名した Request を fetch する
// 鍵はコードに書かない(wrangler の secret の R2_ACCESS_KEY_ID・R2_SECRET_ACCESS_KEY)。

export type S3Credentials = { accessKeyId: string; secretAccessKey: string };
export type S3Target = S3Credentials & {
  /** https://<アカウントID>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  /** R2 は "auto" */
  region?: string;
};

/** Date を SigV4 の日時("20261103T010000Z")にする */
export function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** キーを URL のパスにする(/ は残し、それ以外は1つずつ符号化する) */
export function encodeKey(key: string): string {
  return key
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export function objectUrl(t: S3Target, key: string, query: Record<string, string> = {}): URL {
  const url = new URL(`${t.endpoint.replace(/\/$/, '')}/${encodeURIComponent(t.bucket)}/${encodeKey(key)}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url;
}

/**
 * 署名つき URL(クエリに署名を入れる)。headers に入れたものは署名に含まれ、送る側は同じ値を付ける必要がある
 * (Content-Type を固定するため)。expiresIn は秒
 */
export async function presignUrl(args: {
  credentials: S3Credentials;
  url: URL | string;
  method: 'GET' | 'PUT';
  expiresIn: number;
  now: Date;
  region?: string;
  headers?: Record<string, string>;
}): Promise<string> {
  const url = new URL(args.url.toString());
  url.searchParams.set('X-Amz-Expires', String(args.expiresIn));
  const signer = new AwsV4Signer({
    url: url.toString(),
    method: args.method,
    headers: args.headers,
    accessKeyId: args.credentials.accessKeyId,
    secretAccessKey: args.credentials.secretAccessKey,
    service: 's3',
    region: args.region ?? 'auto',
    signQuery: true,
    // content-type はふつう署名に入れないが、ブラウザから送る Content-Type を固定するために入れる
    allHeaders: !!args.headers,
    datetime: amzDate(args.now),
  });
  const signed = await signer.sign();
  return signed.url.toString();
}

/** サーバーから呼ぶ操作の、署名した Request */
export async function signedRequest(args: {
  credentials: S3Credentials;
  url: URL | string;
  method: string;
  now: Date;
  region?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<Request> {
  const signer = new AwsV4Signer({
    url: args.url.toString(),
    method: args.method,
    headers: args.headers,
    body: args.body,
    accessKeyId: args.credentials.accessKeyId,
    secretAccessKey: args.credentials.secretAccessKey,
    service: 's3',
    region: args.region ?? 'auto',
    datetime: amzDate(args.now),
  });
  const s = await signer.sign();
  return new Request(s.url.toString(), { method: s.method, headers: s.headers, body: s.body as BodyInit | undefined });
}

// ---------------------------------------------------------------- XML(S3 の応答は XML。必要な値だけを取り出す)

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function xmlValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? unescapeXml(m[1]!) : null;
}

export function xmlBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]!);
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** CompleteMultipartUpload の本文 */
export function completeMultipartXml(parts: { partNumber: number; etag: string }[]): string {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  return `<CompleteMultipartUpload>${sorted
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`)
    .join('')}</CompleteMultipartUpload>`;
}

/** ダウンロードのファイル名(日本語を含めてよい。RFC 6266 / 5987) */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
