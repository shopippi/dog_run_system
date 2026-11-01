// SHA-256 の手伝い(Web Crypto。ブラウザ・Workers・Node のどれでも動く)。
// 原本はバイトのまま扱い、デコード・再エンコードしない。ハッシュはブラウザで計算し、サーバーでも確かめる(docs/photo-requirements.md 3.3)。

export type BytesLike = ArrayBuffer | ArrayBufferView | Blob;

async function toArrayBuffer(data: BytesLike): Promise<ArrayBuffer> {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data.arrayBuffer();
}

/** バイト列を小文字の16進にする */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += b.toString(16).padStart(2, '0');
  return s;
}

/** SHA-256 を小文字の16進(64文字)で返す */
export async function sha256Hex(data: BytesLike): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await toArrayBuffer(data));
  return toHex(digest);
}

/** SHA-256 の16進の形か */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/** 2つのハッシュが同じか(大文字・小文字を区別しない。長さが違えば false。比べる時間は中身によらない) */
export function sameSha256(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
