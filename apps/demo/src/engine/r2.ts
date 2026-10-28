// Cloudflare R2 の代わりに、メモリの中の Map に写真を置く。
// API が使う put / get / head / delete / list と httpMetadata を、R2 と同じ形で返す。

export type StoredObject = {
  bytes: Uint8Array;
  contentType?: string;
  uploaded: number;
};

type PutValue = ArrayBuffer | ArrayBufferView | string | Blob | ReadableStream | null;
type PutOptions = { httpMetadata?: { contentType?: string } | Headers; customMetadata?: Record<string, string> };

async function toBytes(value: PutValue): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function contentTypeOf(options?: PutOptions): string | undefined {
  const m = options?.httpMetadata;
  if (!m) return undefined;
  if (m instanceof Headers) return m.get('content-type') ?? undefined;
  return m.contentType;
}

class DemoR2Object {
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
  readonly httpMetadata: { contentType?: string };
  readonly customMetadata: Record<string, string> = {};
  readonly version: string;
  readonly checksums = {};
  readonly storageClass = 'Standard';

  constructor(
    readonly key: string,
    protected readonly stored: StoredObject,
  ) {
    this.size = stored.bytes.byteLength;
    this.etag = `${key.length}-${this.size}-${stored.uploaded}`;
    this.httpEtag = `"${this.etag}"`;
    this.uploaded = new Date(stored.uploaded);
    this.httpMetadata = stored.contentType ? { contentType: stored.contentType } : {};
    this.version = String(stored.uploaded);
  }

  writeHttpMetadata(headers: Headers) {
    if (this.stored.contentType) headers.set('content-type', this.stored.contentType);
  }
}

class DemoR2ObjectBody extends DemoR2Object {
  get body(): ReadableStream {
    return new Blob([this.stored.bytes as BlobPart]).stream();
  }
  get bodyUsed() {
    return false;
  }
  async arrayBuffer() {
    return this.stored.bytes.slice().buffer;
  }
  async bytes() {
    return this.stored.bytes.slice();
  }
  async text() {
    return new TextDecoder().decode(this.stored.bytes);
  }
  async json<T>() {
    return JSON.parse(await this.text()) as T;
  }
  async blob() {
    return new Blob([this.stored.bytes as BlobPart], { type: this.stored.contentType ?? '' });
  }
}

export class DemoR2 {
  readonly objects = new Map<string, StoredObject>();
  /** 保存・削除のたびに呼ぶ(ブラウザの保存領域へ書き込むため) */
  onChange: ((key: string, value: StoredObject | null) => void) | null = null;

  async put(key: string, value: PutValue, options?: PutOptions) {
    const stored: StoredObject = { bytes: await toBytes(value), contentType: contentTypeOf(options), uploaded: Date.now() };
    this.objects.set(key, stored);
    this.onChange?.(key, stored);
    return new DemoR2Object(key, stored);
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    return stored ? new DemoR2ObjectBody(key, stored) : null;
  }

  async head(key: string) {
    const stored = this.objects.get(key);
    return stored ? new DemoR2Object(key, stored) : null;
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (this.objects.delete(key)) this.onChange?.(key, null);
    }
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = options.prefix ?? '';
    const all = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const page = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return {
      objects: page.map((k) => new DemoR2Object(k, this.objects.get(k)!)),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
      delimitedPrefixes: [] as string[],
    };
  }

  /** ブラウザの保存領域から読み戻す(通知はしない) */
  load(entries: Iterable<[string, StoredObject]>) {
    this.objects.clear();
    for (const [k, v] of entries) this.objects.set(k, v);
  }
}
