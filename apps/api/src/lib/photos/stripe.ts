import { PHOTO_LIFF_PATHS, toHex } from '@dr/shared';
import type { Bindings } from '../../env';

// Stripe(docs/photo-requirements.md 8章)。npm の stripe は使わず、fetch で REST API を呼ぶ(Workers で軽いため)。
// - 本番: Stripe Checkout(カード・Apple Pay・Google Pay・PayPay。支払い方法は Stripe のダッシュボードで選ぶ)と返金
// - local・test(STRIPE_MOCK = "1" のときだけ): まねの Stripe。Checkout の代わりに LIFF のまねの支払いの画面へ移り、
//   「支払う」で、本物と同じ形の checkout.session.completed を、本物と同じ方法で署名して Webhook に送る。テストで Stripe を呼ばない
// - Webhook の署名は Web Crypto(HMAC-SHA256)で確かめる。秘密(STRIPE_SECRET_KEY・STRIPE_WEBHOOK_SECRET)は wrangler の secret

export const STRIPE_API = 'https://api.stripe.com/v1';
/** 使う API の版(Stripe はアカウントごとに版を持つので、送る側で固定する) */
export const STRIPE_API_VERSION = '2026-10-28.endive';
/** まねの Stripe の Webhook の秘密(STRIPE_WEBHOOK_SECRET が無いときの、local・test だけの値) */
export const MOCK_WEBHOOK_SECRET = 'whsec_mock_local_only';
/** Webhook の時刻のずれの許容(秒)。Stripe の公式のライブラリと同じ5分 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type CheckoutLine = { name: string; amount: number; quantity?: number };
export type CreateCheckoutArgs = {
  orderId: number;
  lines: CheckoutLine[];
  successUrl: string;
  cancelUrl: string;
  /** 同じ注文で2つ作らないための印 */
  idempotencyKey: string;
  /** Checkout の期限(UNIX 秒。30分〜24時間) */
  expiresAt?: number;
  /** LIFF のまねの支払いの画面の URL を作るため(まねのときだけ) */
  origin: string;
};
export type CheckoutSession = { id: string; url: string; expiresAt: number | null };
export type RefundArgs = { paymentIntent: string; amount: number; idempotencyKey: string; orderId: number };
export type RefundResult = { id: string; status: string };

export interface StripeClient {
  readonly mode: 'live' | 'mock';
  createCheckoutSession(args: CreateCheckoutArgs): Promise<CheckoutSession>;
  retrieveCheckoutSession(id: string): Promise<{ id: string; status: string | null; paymentStatus: string | null; paymentIntent: string | null }>;
  createRefund(args: RefundArgs): Promise<RefundResult>;
}

export class StripeError extends Error {
  constructor(
    public readonly status: number,
    public readonly stripeCode: string | null,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- フォームの形(Stripe の API は application/x-www-form-urlencoded)

/** 入れ子のオブジェクトを Stripe の形(line_items[0][price_data][currency]=jpy)にする */
export function toFormBody(obj: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(prefix ? `${prefix}[${k}]` : k, x);
    else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  walk('', obj);
  return out.join('&');
}

// ---------------------------------------------------------------- 本物

export class LiveStripeClient implements StripeClient {
  readonly mode = 'live' as const;
  constructor(
    private readonly secretKey: string,
    private readonly fetcher: typeof fetch = (req, init) => fetch(req, init),
  ) {}

  private async request<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.secretKey}`,
      'stripe-version': STRIPE_API_VERSION,
    };
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const res = await this.fetcher(`${STRIPE_API}${path}`, { method, headers, body: body ? toFormBody(body) : undefined });
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T;
    if (!res.ok) throw new StripeError(res.status, json.error?.code ?? null, json.error?.message ?? `Stripe ${res.status}`);
    return json;
  }

  async createCheckoutSession(args: CreateCheckoutArgs): Promise<CheckoutSession> {
    const s = await this.request<{ id: string; url: string; expires_at?: number }>(
      'POST',
      '/checkout/sessions',
      {
        mode: 'payment',
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
        client_reference_id: String(args.orderId),
        metadata: { order_id: String(args.orderId) },
        payment_intent_data: { metadata: { order_id: String(args.orderId) } },
        expires_at: args.expiresAt,
        locale: 'ja',
        line_items: args.lines.map((l) => ({
          quantity: l.quantity ?? 1,
          // 日本円は小数のない通貨。amount はそのまま円
          price_data: { currency: 'jpy', unit_amount: l.amount, product_data: { name: l.name } },
        })),
      },
      args.idempotencyKey,
    );
    return { id: s.id, url: s.url, expiresAt: s.expires_at ?? null };
  }

  async retrieveCheckoutSession(id: string) {
    const s = await this.request<{ id: string; status: string | null; payment_status: string | null; payment_intent: string | null }>(
      'GET',
      `/checkout/sessions/${encodeURIComponent(id)}`,
    );
    return { id: s.id, status: s.status, paymentStatus: s.payment_status, paymentIntent: s.payment_intent };
  }

  async createRefund(args: RefundArgs): Promise<RefundResult> {
    const r = await this.request<{ id: string; status: string }>(
      'POST',
      '/refunds',
      { payment_intent: args.paymentIntent, amount: args.amount, metadata: { order_id: String(args.orderId) } },
      args.idempotencyKey,
    );
    return { id: r.id, status: r.status };
  }
}

// ---------------------------------------------------------------- まね(local・test)

/** まねの Checkout の番号("cs_mock_" + 注文の番号 + ランダム) */
export function mockSessionId(orderId: number): string {
  return `cs_mock_${orderId}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** まねの Checkout の番号から注文の番号を読む */
export function orderIdFromMockSession(id: string): number | null {
  const m = /^cs_mock_(\d+)_[0-9a-f]{16}$/.exec(id);
  return m ? Number(m[1]) : null;
}

export class MockStripeClient implements StripeClient {
  readonly mode = 'mock' as const;
  async createCheckoutSession(args: CreateCheckoutArgs): Promise<CheckoutSession> {
    const id = mockSessionId(args.orderId);
    // Stripe の画面の代わりに、LIFF のまねの支払いの画面(PU-5 の一部。段階1-C)へ移る
    return { id, url: `${args.origin}/liff${PHOTO_LIFF_PATHS.mockCheckout(id)}`, expiresAt: args.expiresAt ?? null };
  }
  async retrieveCheckoutSession(id: string) {
    return { id, status: 'open', paymentStatus: 'unpaid', paymentIntent: null };
  }
  async createRefund(args: RefundArgs): Promise<RefundResult> {
    return { id: `re_mock_${args.orderId}_${crypto.randomUUID().slice(0, 8)}`, status: 'succeeded' };
  }
}

/** まねの Webhook のイベント(本物と同じ形の、必要なところだけ) */
export function mockStripeEvent(type: 'checkout.session.completed' | 'checkout.session.expired' | 'charge.refunded', object: Record<string, unknown>, now: Date) {
  return {
    id: `evt_mock_${crypto.randomUUID().replace(/-/g, '')}`,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: Math.floor(now.getTime() / 1000),
    livemode: false,
    type,
    data: { object },
  };
}

/** まねの checkout.session.completed の中身 */
export function mockCompletedSession(args: { sessionId: string; orderId: number; amount: number }) {
  return {
    id: args.sessionId,
    object: 'checkout.session',
    amount_total: args.amount,
    currency: 'jpy',
    client_reference_id: String(args.orderId),
    metadata: { order_id: String(args.orderId) },
    mode: 'payment',
    payment_intent: `pi_mock_${args.orderId}`,
    payment_status: 'paid',
    status: 'complete',
  };
}

// ---------------------------------------------------------------- Webhook の署名

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Stripe-Signature の値を作る(まねの Stripe とテスト用)。本物と同じ: t=<秒>,v1=HMAC(secret, "<t>.<本文>") */
export async function signStripePayload(secret: string, payload: string, now: Date): Promise<string> {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'mismatch' | 'too_old' };

/**
 * Webhook の署名を確かめる。本文は受け取ったまま(JSON にしてから戻さない)を使う。
 * 時刻のずれが5分を超えるもの(やり直しの攻撃)は受け付けない。v1 が複数あれば、どれか1つが合えばよい(秘密の入れ替えの途中)
 */
export async function verifyStripeSignature(args: {
  payload: string;
  header: string | null | undefined;
  secret: string;
  now: Date;
  toleranceSeconds?: number;
}): Promise<SignatureCheck> {
  if (!args.header) return { ok: false, reason: 'missing' };
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of args.header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't' && v && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && v) v1.push(v.toLowerCase());
  }
  if (t === null || v1.length === 0) return { ok: false, reason: 'malformed' };
  const expected = await hmacHex(args.secret, `${t}.${args.payload}`);
  if (!v1.some((s) => safeEqualHex(s, expected))) return { ok: false, reason: 'mismatch' };
  if (Math.abs(args.now.getTime() / 1000 - t) > (args.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return { ok: false, reason: 'too_old' };
  return { ok: true };
}

// ---------------------------------------------------------------- 選ぶ

/** まねの Stripe を使ってよいか(local・test で STRIPE_MOCK = "1" のときだけ。本番では決して使わない) */
export function stripeMockEnabled(env: Pick<Bindings, 'ENVIRONMENT' | 'STRIPE_MOCK'>): boolean {
  return (env.ENVIRONMENT === 'local' || env.ENVIRONMENT === 'test') && env.STRIPE_MOCK === '1';
}

/** 本物の鍵がそろっているか */
export function stripeLiveConfigured(env: Pick<Bindings, 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET'>): boolean {
  return !!env.STRIPE_SECRET_KEY?.trim() && !!env.STRIPE_WEBHOOK_SECRET?.trim();
}

/** Stripe の窓口。本物の鍵があれば本物、なければ(local・test で許されていれば)まね、どちらもなければ null(「準備中」) */
export function stripeClient(env: Bindings): StripeClient | null {
  if (stripeLiveConfigured(env) && !stripeMockEnabled(env)) return new LiveStripeClient(env.STRIPE_SECRET_KEY!.trim());
  if (stripeMockEnabled(env)) return new MockStripeClient();
  return null;
}

/** Webhook の署名の秘密(まねのときは決まった値) */
export function webhookSecret(env: Bindings): string | null {
  if (stripeMockEnabled(env)) return env.STRIPE_WEBHOOK_SECRET?.trim() || MOCK_WEBHOOK_SECRET;
  return env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}
