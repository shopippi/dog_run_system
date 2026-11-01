// 代わりの置き場所(local・test・デモ)のダウンロードの URL に付ける、短い期限の署名(HMAC-SHA256)。
// R2 の署名つき URL と同じく、URL を知っている人が期限まで(5分)受け取れる。中身は改ざんできない。
// 形: <中身(JSON)を base64url>.<署名を base64url>

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** e は期限(UNIX 秒)。ほかの中身は使う側が決める(1枚: k・f・t、ZIP: 段階1-D) */
export type FileTokenPayload = { e: number; [k: string]: unknown };

export async function signFileToken(secret: string, payload: FileTokenPayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

/** 署名が正しく、期限内なら中身を返す。だめなら null */
export async function verifyFileToken<T extends FileTokenPayload = FileTokenPayload>(
  secret: string,
  token: string,
  now: Date,
): Promise<T | null> {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  let given: Uint8Array;
  try {
    given = fromB64url(sig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(given, await hmac(secret, body))) return null;
  let payload: T;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
  } catch {
    return null;
  }
  if (typeof payload.e !== 'number' || payload.e * 1000 <= now.getTime()) return null;
  return payload;
}
