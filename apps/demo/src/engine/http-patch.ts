// ブラウザの Request と Response は、Cookie と Set-Cookie のヘッダーを黙って捨てる(fetch の仕様)。
// 本物の Workers では使えるので、デモではこれを補う:
// - API に渡す Request には、Cookie を含むヘッダーを別に持たせる(withHeaders)
// - API が作る Response は、Set-Cookie を落とさない形にする(installResponsePatch)

/** Request のヘッダーを、Cookie も入る Headers に差し替える。 */
export function withHeaders(req: Request, headers: Headers): Request {
  Object.defineProperty(req, 'headers', { value: headers, configurable: true });
  return req;
}

let installed = false;

/**
 * globalThis.Response を、ヘッダーを落とさない Response に差し替える。
 * 中身(本文・状態)はブラウザの Response のまま。headers だけを、制限のない Headers で持つ。
 * デモ画面(親の画面)の中だけで使う。iframe の中の画面には影響しない。
 */
export function installResponsePatch() {
  if (installed) return;
  installed = true;
  const Native = globalThis.Response;
  class DemoResponse extends Native {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init);
      const h = new Headers(init?.headers);
      // 本文から決まる content-type(文字列なら text/plain など)を引き継ぐ
      const native = Object.getOwnPropertyDescriptor(Native.prototype, 'headers')!.get!.call(this) as Headers;
      const ct = native.get('content-type');
      if (ct && !h.has('content-type')) h.set('content-type', ct);
      Object.defineProperty(this, 'headers', { value: h, configurable: true });
    }
  }
  Object.defineProperty(globalThis, 'Response', { value: DemoResponse, configurable: true, writable: true });
}
