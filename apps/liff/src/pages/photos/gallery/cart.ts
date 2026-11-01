import { cartAddSchema, type CartAddResponse, type CartItem, type CartResponse } from '@dr/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, postJson } from '../../../lib/api';

// ギャラリーから見たカート(サーバーのカート。GET /api/photos/cart・POST /api/photos/cart/items。作るのは段階1-C)。
// - ヘッダーの近くにカートの数を出す・グリッドとビューアで「カートに入っています」の印を付けるために読む
// - 入れるときは、選んだものをまとめて1回で送る(cartAddSchema の形。同じものは送る前に除く)
// - 1-C の API ができる前(501)は、数を出さず、入れようとしたら「準備中」と知らせる

export type CartState =
  | { kind: 'loading' }
  | { kind: 'ready'; cart: CartResponse }
  /** カートの API がまだない(501)・読めなかった */
  | { kind: 'unavailable'; error: unknown };

let state: CartState = { kind: 'loading' };
let inflight: Promise<void> | null = null;
const listeners = new Set<(s: CartState) => void>();

function set(next: CartState) {
  state = next;
  for (const l of listeners) l(state);
}

/** カートを読み直す(同時に何度呼んでも、通信は1回) */
export function refreshCart(): Promise<void> {
  inflight ??= api<CartResponse>('/api/photos/cart', { attempts: 2 })
    .then((cart) => set({ kind: 'ready', cart }))
    .catch((error: unknown) => set({ kind: 'unavailable', error }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export type CartView = {
  state: CartState;
  /** カートに入っている行の数(買えない行も含む。カートの画面と同じ数) */
  count: number | null;
  /** カートに入っている写真(1枚ずつの行) */
  photoIds: ReadonlySet<number>;
  /** まるごとでカートに入っているアルバム */
  albumIds: ReadonlySet<number>;
};

/** カートの中身(画面のあいだで共有する。画面を開くたびに読み直す。カートの画面で外したものを反映するため) */
export function useCart(): CartView {
  const [s, setS] = useState<CartState>(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    void refreshCart();
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return useMemo(() => {
    if (s.kind !== 'ready') return { state: s, count: null, photoIds: new Set(), albumIds: new Set() };
    const items = s.cart.items;
    return {
      state: s,
      count: items.length,
      photoIds: new Set(items.filter((i) => i.kind === 'photo' && i.photoId !== null).map((i) => i.photoId!)),
      albumIds: new Set(items.filter((i) => i.kind === 'album').map((i) => i.albumId)),
    };
  }, [s]);
}

const SKIP_WORDS: Record<CartAddResponse['skipped'][number]['reason'], string> = {
  already_in_cart: 'すでにカートにありました',
  already_owned: '購入済みでした',
  ended: '販売が終わっていました',
  hidden: '見られなくなっていました',
  not_found: '見つかりませんでした',
  no_album_price: 'まるごとでは買えなくなっていました',
};

/** 入れた結果を、トーストの一文にする(「3枚をカートに入れました。1枚はすでにカートにありました。」) */
export function addResultMessage(res: CartAddResponse, items: CartItem[]): string {
  const album = items.length === 1 && items[0]!.kind === 'album';
  const head = res.added > 0 ? (album ? 'アルバムまるごとをカートに入れました。' : `${res.added}枚をカートに入れました。`) : '';
  const counts = new Map<string, number>();
  for (const s of res.skipped) counts.set(SKIP_WORDS[s.reason], (counts.get(SKIP_WORDS[s.reason]) ?? 0) + 1);
  const tail = [...counts].map(([w, n]) => (album ? `アルバムまるごとは${w}。` : `${n}枚は${w}。`)).join('');
  return head + tail || 'カートに入れるものがありませんでした。';
}

/** 準備中(1-C の API ができる前の 501)のときの文 */
export const CART_NOT_READY_MESSAGE = 'カートに入れる機能は準備中です。できるようになるまで、もうしばらくお待ちください。';

/** まとめてカートに入れる。入れたあとのカートで、画面の印を最新にする */
export async function addToCart(items: CartItem[]): Promise<CartAddResponse> {
  const body = cartAddSchema.parse({ items });
  try {
    const res = await postJson<CartAddResponse>('/api/photos/cart/items', body);
    set({ kind: 'ready', cart: { items: res.items, total: res.total, payableCount: res.payableCount } });
    return res;
  } catch (e) {
    if (e instanceof ApiError && e.status === 501) throw new ApiError(501, e.code, CART_NOT_READY_MESSAGE);
    throw e;
  }
}
