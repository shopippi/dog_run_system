// R2 を使わないときの写真の保存先(データベースの media_objects 表)。
// R2 の利用を始めていない Cloudflare のアカウントでも、写真の機能をそのまま動かすためのもの。
// コードが使っている R2 の機能(put / get / head / delete / list)だけを、同じ形で用意する。
// D1 の1行は 2MB まで。写真は画面で 1200px 以下に縮小してから送るので、ふつうは数百KB に収まる。

type PutValue = ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null;
type PutOptions = { httpMetadata?: { contentType?: string } | Headers };

/** D1 の1行に入る大きさ(行のほかの列のぶんを引いた、写真の上限) */
export const D1_MEDIA_MAX_BYTES = 1_900_000;

async function toBytes(value: PutValue): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function contentTypeOf(options?: PutOptions): string | null {
  const m = options?.httpMetadata;
  if (!m) return null;
  if (m instanceof Headers) return m.get('content-type');
  return m.contentType ?? null;
}

type Row = { key: string; bytes?: ArrayBuffer | number[]; content_type: string | null; size: number; uploaded_at: number };

function rowBytes(b: ArrayBuffer | number[] | undefined): Uint8Array {
  if (!b) return new Uint8Array();
  return b instanceof ArrayBuffer ? new Uint8Array(b) : Uint8Array.from(b);
}

class D1MediaObject {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
  readonly httpMetadata: { contentType?: string };
  readonly customMetadata: Record<string, string> = {};
  readonly version: string;
  readonly checksums = {};
  readonly storageClass = 'Standard';

  constructor(row: Row) {
    this.key = row.key;
    this.size = row.size;
    this.etag = `${row.size}-${row.uploaded_at}`;
    this.httpEtag = `"${this.etag}"`;
    this.uploaded = new Date(row.uploaded_at);
    this.httpMetadata = row.content_type ? { contentType: row.content_type } : {};
    this.version = String(row.uploaded_at);
  }

  writeHttpMetadata(headers: Headers) {
    if (this.httpMetadata.contentType) headers.set('content-type', this.httpMetadata.contentType);
  }
}

class D1MediaObjectBody extends D1MediaObject {
  readonly #bytes: Uint8Array;
  constructor(row: Row) {
    super(row);
    this.#bytes = rowBytes(row.bytes);
  }
  get body(): ReadableStream {
    return new Blob([this.#bytes]).stream();
  }
  get bodyUsed() {
    return false;
  }
  async arrayBuffer() {
    return this.#bytes.slice().buffer;
  }
  async bytes() {
    return this.#bytes.slice();
  }
  async text() {
    return new TextDecoder().decode(this.#bytes);
  }
  async json<T>() {
    return JSON.parse(await this.text()) as T;
  }
  async blob() {
    return new Blob([this.#bytes], { type: this.httpMetadata.contentType ?? '' });
  }
}

export class D1Media {
  constructor(private readonly db: D1Database) {}

  async put(key: string, value: PutValue, options?: PutOptions) {
    const bytes = await toBytes(value);
    if (bytes.byteLength > D1_MEDIA_MAX_BYTES) {
      throw new Error(`写真が大きすぎます(${bytes.byteLength} バイト)。`);
    }
    const row: Row = { key, content_type: contentTypeOf(options), size: bytes.byteLength, uploaded_at: Date.now() };
    await this.db
      .prepare(
        `INSERT INTO media_objects (key, bytes, content_type, size, uploaded_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET bytes = excluded.bytes, content_type = excluded.content_type,
           size = excluded.size, uploaded_at = excluded.uploaded_at`,
      )
      .bind(key, bytes, row.content_type, row.size, row.uploaded_at)
      .run();
    return new D1MediaObject(row);
  }

  async get(key: string) {
    const row = await this.db
      .prepare('SELECT key, bytes, content_type, size, uploaded_at FROM media_objects WHERE key = ?')
      .bind(key)
      .first<Row>();
    return row ? new D1MediaObjectBody(row) : null;
  }

  async head(key: string) {
    const row = await this.db
      .prepare('SELECT key, content_type, size, uploaded_at FROM media_objects WHERE key = ?')
      .bind(key)
      .first<Row>();
    return row ? new D1MediaObject(row) : null;
  }

  async delete(keys: string | string[]) {
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.length === 0) return;
    await this.db.batch(list.map((k) => this.db.prepare('DELETE FROM media_objects WHERE key = ?').bind(k)));
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = options.prefix ?? '';
    const limit = Math.min(options.limit ?? 1000, 1000);
    const after = options.cursor ?? '';
    const { results } = await this.db
      .prepare(
        `SELECT key, content_type, size, uploaded_at FROM media_objects
          WHERE key >= ?1 AND key < ?1 || char(1114111) AND key > ?2 ORDER BY key LIMIT ?3`,
      )
      .bind(prefix, after, limit + 1)
      .all<Row>();
    const truncated = results.length > limit;
    const page = results.slice(0, limit);
    return {
      objects: page.map((r) => new D1MediaObject(r)),
      truncated,
      cursor: truncated ? page[page.length - 1]!.key : undefined,
      delimitedPrefixes: [] as string[],
    };
  }
}

/**
 * 写真の保存先を決める。R2(MEDIA)がつながっていればそれを使い、なければデータベースに保存する。
 * MEDIA_BACKEND は "r2" か "d1"(バックアップなど、R2 でしか意味のない処理の判断に使う)。
 */
export function withMedia<E extends { DB: D1Database; MEDIA?: R2Bucket }>(env: E): E & { MEDIA: R2Bucket; MEDIA_BACKEND: 'r2' | 'd1' } {
  // env は Cloudflare が渡す特別なオブジェクトで、値を写す({ ...env })と一部の値が抜け落ちることがある。
  // 元の env を引き継いだ(プロトタイプにした)オブジェクトに、写真の保存先だけを足す。
  const out = Object.create(env) as E & { MEDIA: R2Bucket; MEDIA_BACKEND: 'r2' | 'd1' };
  if (env.MEDIA) {
    Object.defineProperty(out, 'MEDIA_BACKEND', { value: 'r2', enumerable: true });
  } else {
    Object.defineProperty(out, 'MEDIA', { value: new D1Media(env.DB) as unknown as R2Bucket, enumerable: true });
    Object.defineProperty(out, 'MEDIA_BACKEND', { value: 'd1', enumerable: true });
  }
  return out;
}
