import { env } from 'cloudflare:test';
import { sha256Hex } from '@dr/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { photoStorage, type PhotoStorage } from '../src/lib/photos/storage';
import { mockCompletedSession, mockStripeEvent, signStripePayload, MOCK_WEBHOOK_SECRET } from '../src/lib/photos/stripe';
import { notifyPurchase } from '../src/services/photos/notify';
import { processStripeEvent } from '../src/services/photos/webhook';
import { call, registerUser } from './helpers';
import { BUYER, NOW, addItems, addToAlbum, buy, checkout, enablePhotoSales, entitlementsOf, getCart, payMock, seedAlbum, seedPhoto } from './p8-checkout-fixtures';

// Stripe の Webhook(docs/photo-requirements.md 8.2)。署名・同じイベントは1回・権利・まるごとの範囲・購入済み領域のコピーと SHA-256・LINE のお知らせ

beforeEach(enablePhotoSales);

/** 本文を文字列のまま送る(call は JSON にしてしまうため、SELF.fetch を使う) */
async function postRaw(payload: string, signature: string | null, now = NOW) {
  const { SELF } = await import('cloudflare:test');
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-debug-now': now };
  if (signature) headers['stripe-signature'] = signature;
  const res = await SELF.fetch('https://dogrun.test/api/photos/stripe/webhook', { method: 'POST', headers, body: payload });
  return { status: res.status, body: (await res.json()) as any };
}

async function signedPost(event: unknown, now = NOW) {
  const payload = JSON.stringify(event);
  return postRaw(payload, await signStripePayload(MOCK_WEBHOOK_SECRET, payload, new Date(now)), now);
}

async function pendingOrder() {
  const a = await seedAlbum({ unitPrice: 500, photos: 2 });
  await addItems(a.photoIds.map((photoId) => ({ kind: 'photo' as const, albumId: a.albumId, photoId })));
  const co = await checkout();
  const order = await env.DB.prepare('SELECT id, amount, stripe_session_id FROM orders WHERE id = ?').bind(co.body.orderId).first<{ id: number; amount: number; stripe_session_id: string }>();
  return { album: a, order: order!, checkoutUrl: co.body.checkoutUrl as string };
}

const completed = (o: { id: number; amount: number; stripe_session_id: string }, amount = o.amount) =>
  mockStripeEvent('checkout.session.completed', mockCompletedSession({ sessionId: o.stripe_session_id, orderId: o.id, amount }), new Date(NOW));

describe('署名', () => {
  it('署名が合わない・ない・古いものは 400 で、何もしない', async () => {
    const { order } = await pendingOrder();
    const event = completed(order);
    const payload = JSON.stringify(event);
    const bad = await postRaw(payload, await signStripePayload('whsec_wrong', payload, new Date(NOW)));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('bad_signature');
    expect((await postRaw(payload, null)).status).toBe(400);
    const old = await postRaw(payload, await signStripePayload(MOCK_WEBHOOK_SECRET, payload, new Date('2026-11-03T09:50:00+09:00')));
    expect(old.status).toBe(400);
    // 本文を書き換えたもの(金額を0に)
    const tampered = await postRaw(payload.replace(`"amount_total":${order.amount}`, '"amount_total":0'), await signStripePayload(MOCK_WEBHOOK_SECRET, payload, new Date(NOW)));
    expect(tampered.status).toBe(400);
    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(order.id).first<{ status: string }>();
    expect(row!.status).toBe('pending');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM webhook_events').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('お支払いの確定(checkout.session.completed)', () => {
  it('まねの支払いの道で通しで: paid・権利・購入済み領域へコピー(SHA-256 が一致)・カートから出る・お知らせを記録', async () => {
    const { album, order, checkoutUrl } = await pendingOrder();
    const pay = await payMock(checkoutUrl);
    expect(pay.status).toBe(200);
    expect(pay.body).toMatchObject({ webhookStatus: 200, redirectUrl: `https://dogrun.test/liff/photos/orders/${order.id}` });
    const row = await env.DB.prepare('SELECT status, paid_at, stripe_payment_intent FROM orders WHERE id = ?').bind(order.id).first();
    expect(row).toEqual({ status: 'paid', paid_at: NOW, stripe_payment_intent: `pi_mock_${order.id}` });
    expect((await entitlementsOf()).map((e) => e.photo_id)).toEqual(album.photoIds);
    // 購入済み領域のファイルは、原本とバイト単位で同じ
    const storage = photoStorage(env)!;
    for (const id of album.photoIds) {
      const p = await env.DB.prepare('SELECT original_key, purchased_key, sha256, purchased_verified_at, hash_mismatch_at FROM photos WHERE id = ?').bind(id).first<any>();
      expect(p.purchased_key).toMatch(/^purchased\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
      expect(p.purchased_verified_at).toBe(NOW);
      expect(p.hash_mismatch_at).toBeNull();
      const copy = await storage.get(p.purchased_key);
      expect(await sha256Hex(new Uint8Array(await new Response(copy!.body).arrayBuffer()))).toBe(p.sha256);
    }
    expect((await getCart()).body.items).toEqual([]);
    const cart = await env.DB.prepare('SELECT COUNT(*) AS n FROM cart_items WHERE order_id = ? AND ordered_at IS NOT NULL').bind(order.id).first<{ n: number }>();
    expect(cart!.n).toBe(2);
    // local・test は LINE のトークンがないので「送っていない(no_token)」で記録する(注文は止めない)
    const n = await env.DB.prepare('SELECT status, reason, message FROM photo_notifications WHERE order_id = ?').bind(order.id).first<any>();
    expect(n).toMatchObject({ status: 'skipped', reason: 'no_token' });
    expect(n.message).toContain('写真の購入が完了しました');
    const ev = await env.DB.prepare('SELECT type, status FROM webhook_events').first();
    expect(ev).toEqual({ type: 'checkout.session.completed', status: 'processed' });
    // 購入完了の画面は paid を読む
    const mine = await call(`/api/photos/orders/${order.id}`, { user: BUYER });
    expect(mine.body.order.status).toBe('paid');
  });

  it('同じイベントの2回目は何もしない(権利・コピー・お知らせは1回だけ)', async () => {
    const { order } = await pendingOrder();
    const event = completed(order);
    const first = await signedPost(event);
    expect(first.body).toEqual({ received: true, status: 'processed' });
    const keys = await env.DB.prepare('SELECT purchased_key FROM photos ORDER BY id').all();
    const second = await signedPost(event);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received: true, status: 'duplicate' });
    expect(await entitlementsOf()).toHaveLength(2);
    expect((await env.DB.prepare('SELECT purchased_key FROM photos ORDER BY id').all()).results).toEqual(keys.results);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM photo_notifications').first<{ n: number }>())!.n).toBe(1);
    // 別のイベントの番号で同じ Session が届いても、注文はもう paid(二重に確定しない)
    const again = await signedPost(completed(order));
    expect(again.body.status).toBe('processed');
    expect(await entitlementsOf()).toHaveLength(2);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM photo_notifications').first<{ n: number }>())!.n).toBe(1);
    // まねの「支払う」の2回目は 409
    expect((await payMock(order.stripe_session_id)).status).toBe(409);
  });

  it('金額が注文と違えば確定しない(操作ログに残す)', async () => {
    const { order } = await pendingOrder();
    const r = await signedPost(completed(order, 1));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ignored');
    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(order.id).first<{ status: string }>();
    expect(row!.status).toBe('pending');
    expect(await entitlementsOf()).toEqual([]);
    const log = await env.DB.prepare("SELECT actor_type, reason FROM audit_log WHERE action = 'photo_order.amount_mismatch'").first<any>();
    expect(log.actor_type).toBe('system');
    const ev = await env.DB.prepare('SELECT status, error FROM webhook_events').first();
    expect(ev).toEqual({ status: 'ignored', error: 'amount_mismatch' });
  });

  it('知らない注文・ほかのイベントは ignored で 200', async () => {
    const r = await signedPost(mockStripeEvent('checkout.session.completed', mockCompletedSession({ sessionId: 'cs_mock_99_0123456789abcdef', orderId: 99, amount: 500 }), new Date(NOW)));
    expect(r.body.status).toBe('ignored');
    const other = await signedPost({ id: 'evt_x', type: 'customer.created', data: { object: {} } });
    expect(other.body.status).toBe('ignored');
  });

  it('アルバムまるごと: お支払いの時点で公開中の写真だけ。非公開・外した・あとから公開・すでに持っている写真は含めない', async () => {
    const a = await seedAlbum({ unitPrice: 500, albumPrice: 2000, photos: 3 });
    // 前に1枚で買った写真
    await buy([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
    const hidden = await seedPhoto();
    await addToAlbum(a.albumId, hidden.photoId, { status: 'hidden' });
    const removed = await seedPhoto();
    await addToAlbum(a.albumId, removed.photoId, { status: 'removed' });
    const draft = await seedPhoto();
    await addToAlbum(a.albumId, draft.photoId, { status: 'draft' });
    await addItems([{ kind: 'album', albumId: a.albumId }]);
    const co = await checkout();
    expect(co.body.amount).toBe(2000);
    // 支払いの前に、もう1枚公開した(お支払いの時点で公開中なので含める)
    const late = await seedPhoto();
    await addToAlbum(a.albumId, late.photoId, { status: 'published', publishedAt: '2026-11-03T09:59:00+09:00' });
    // お支払いより後の日時で公開された写真(含めない)
    const future = await seedPhoto();
    await addToAlbum(a.albumId, future.photoId, { status: 'published', publishedAt: '2026-11-03T12:00:00+09:00' });
    await payMock(co.body.checkoutUrl);
    const ents = await entitlementsOf();
    const albumItem = await env.DB.prepare("SELECT id FROM order_items WHERE order_id = ? AND kind = 'album'").bind(co.body.orderId).first<{ id: number }>();
    const fromAlbum = ents.filter((e) => e.order_item_id === albumItem!.id).map((e) => e.photo_id).sort((x, y) => x - y);
    expect(fromAlbum).toEqual([a.photoIds[1]!, a.photoIds[2]!, late.photoId].sort((x, y) => x - y));
    expect(ents.map((e) => e.photo_id)).not.toContain(hidden.photoId);
    expect(ents.map((e) => e.photo_id)).not.toContain(removed.photoId);
    expect(ents.map((e) => e.photo_id)).not.toContain(draft.photoId);
    expect(ents.map((e) => e.photo_id)).not.toContain(future.photoId);
    // 前に買った写真の権利は、前の注文の明細のまま(足さない)
    expect(ents.filter((e) => e.photo_id === a.photoIds[0])).toHaveLength(1);
    const mine = await call(`/api/photos/orders/${co.body.orderId}`, { user: BUYER });
    expect(mine.body.order.lines[0]).toMatchObject({ kind: 'album', photoCount: 3 });
  });

  it('まるごとに含まれていた1枚の行も、カートから出る', async () => {
    const a = await seedAlbum({ albumPrice: 1500, photos: 2 });
    await addItems([
      { kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! },
      { kind: 'album', albumId: a.albumId },
    ]);
    const co = await checkout();
    await payMock(co.body.checkoutUrl);
    expect((await getCart()).body.items).toEqual([]);
  });

  it('お支払いをやめた・期限切れ(checkout.session.expired)は expired。カートはそのまま', async () => {
    const { order } = await pendingOrder();
    const r = await signedPost(mockStripeEvent('checkout.session.expired', { id: order.stripe_session_id, object: 'checkout.session' }, new Date(NOW)));
    expect(r.body.status).toBe('processed');
    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(order.id).first<{ status: string }>();
    expect(row!.status).toBe('expired');
    expect((await getCart()).body.items).toHaveLength(2);
    // 期限が切れたあとに completed が来ても確定しない
    const late = await signedPost(completed(order));
    expect(late.body.status).toBe('ignored');
  });
});

describe('購入済み領域へのコピーの確かめ(SHA-256)', () => {
  /** コピーのときにバイトを1つ変えてしまう置き場所(壊れたコピーのまね) */
  function corruptingStorage(base: PhotoStorage): PhotoStorage {
    return new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'copy') {
          return async (src: string, dst: string) => {
            const f = await target.get(src);
            const bytes = new Uint8Array(await new Response(f!.body).arrayBuffer());
            bytes[0] = bytes[0]! ^ 0xff;
            await target.put(dst, bytes, 'image/jpeg');
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }

  it('合わなければ purchased_key を入れず、hash_mismatch_at と操作ログで知らせる', async () => {
    const { order, album } = await pendingOrder();
    const storage = corruptingStorage(photoStorage(env)!);
    const out = await processStripeEvent({ env, storage, now: new Date(NOW) }, completed(order));
    expect(out.status).toBe('processed');
    expect(out.note).toBe(`hash_mismatch:${album.photoIds.join(',')}`);
    const rows = await env.DB.prepare('SELECT purchased_key, purchased_verified_at, hash_mismatch_at FROM photos ORDER BY id').all<any>();
    for (const r of rows.results) expect(r).toEqual({ purchased_key: null, purchased_verified_at: null, hash_mismatch_at: NOW });
    const logs = await env.DB.prepare("SELECT target_id, actor_type, reason FROM audit_log WHERE action = 'photo.hash_mismatch' ORDER BY id").all<any>();
    expect(logs.results.map((l) => Number(l.target_id))).toEqual(album.photoIds);
    expect(logs.results[0].reason).toContain('一致しませんでした');
    // 注文は確定している(お金は受け取った。写真は管理者が確かめる)
    expect((await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(order.id).first<{ status: string }>())!.status).toBe('paid');
  });

  it('コピーに失敗したら 500(failed)。送り直しで、続きからコピーする', async () => {
    const { order } = await pendingOrder();
    const base = photoStorage(env)!;
    const failing = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'copy') return async () => { throw new Error('つながりません'); };
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const event = completed(order);
    await expect(processStripeEvent({ env, storage: failing, now: new Date(NOW) }, event)).rejects.toThrow('つながりません');
    expect(await env.DB.prepare('SELECT status, error FROM webhook_events').first()).toEqual({ status: 'failed', error: 'つながりません' });
    // 注文と権利は確定済み。コピーだけ残っている
    expect((await env.DB.prepare('SELECT status FROM orders').first<{ status: string }>())!.status).toBe('paid');
    const retry = await processStripeEvent({ env, storage: base, now: new Date(NOW) }, event);
    expect(retry.status).toBe('processed');
    const keys = await env.DB.prepare('SELECT COUNT(purchased_key) AS n FROM photos').first<{ n: number }>();
    expect(keys!.n).toBe(2);
    expect(await entitlementsOf()).toHaveLength(2);
  });

  it('同じ写真がもう購入済み領域にあれば、コピーしない(ほかの購入者と共有)', async () => {
    const a = await seedAlbum({ photos: 1 });
    await buy([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }], 'U950:さき');
    const key = await env.DB.prepare('SELECT purchased_key FROM photos WHERE id = ?').bind(a.photoIds[0]).first<{ purchased_key: string }>();
    await buy([{ kind: 'photo', albumId: a.albumId, photoId: a.photoIds[0]! }]);
    const after = await env.DB.prepare('SELECT purchased_key FROM photos WHERE id = ?').bind(a.photoIds[0]).first<{ purchased_key: string }>();
    expect(after!.purchased_key).toBe(key!.purchased_key);
  });
});

describe('購入完了の LINE のお知らせ', () => {
  async function paidOrderId() {
    const a = await seedAlbum({ photos: 2 });
    return buy(a.photoIds.map((photoId) => ({ kind: 'photo' as const, albumId: a.albumId, photoId })));
  }

  it('トークンがあれば送る(local・test は送ったつもり)。文に「購入した写真」へのリンク。1つの注文に1回だけ', async () => {
    const orderId = await paidOrderId();
    await env.DB.prepare('DELETE FROM photo_notifications').run();
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('liff_id', '\"1234567890-AbCdEf\"', ?)").bind(NOW).run();
    const transport = vi.fn(async () => ({ ok: true as const, mock: true }));
    const r = await notifyPurchase({ ...env, LINE_MESSAGING_TOKEN: 'tok' }, orderId, new Date(NOW), transport);
    expect(r).toEqual({ status: 'sent', reason: 'mock' });
    expect(transport).toHaveBeenCalledTimes(1);
    const [, to, text] = transport.mock.calls[0] as unknown as [string, string, string];
    expect(to).toBe('U901');
    expect(text).toContain('写真の購入が完了しました');
    expect(text).toContain('写真2枚(合計 1,000円)');
    expect(text).toContain('https://liff.line.me/1234567890-AbCdEf/photos/purchased');
    const again = await notifyPurchase({ ...env, LINE_MESSAGING_TOKEN: 'tok' }, orderId, new Date(NOW), transport);
    expect(again.status).toBe('sent');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('ひと月の上限は、予約のお知らせと合わせて数える。上限なら送らずに記録する(注文は止めない)', async () => {
    const orderId = await paidOrderId();
    await env.DB.prepare('DELETE FROM photo_notifications').run();
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('booking_notify', '{"confirmed":true,"declined":true,"monthly_limit":1}', ?)`,
    )
      .bind(NOW)
      .run();
    // 予約のお知らせを今月1通送ったことにする
    await registerUser('U960:よやく');
    await env.DB.prepare(
      `INSERT INTO bookings (household_id, service, status, start_date, end_date, start_time, end_time, occupy_from, occupy_to,
                             estimate_total, estimate_detail, source, token, created_at, updated_at)
       SELECT id, 'daycare', 'confirmed', '2026-11-05', '2026-11-05', '09:00', '17:00', '2026-11-05', '2026-11-05', 3000, '{}', 'customer', 't1', ?1, ?1
         FROM households LIMIT 1`,
    )
      .bind(NOW)
      .run();
    await env.DB.prepare(
      "INSERT INTO booking_notifications (booking_id, kind, status, message, month, created_at) SELECT id, 'confirmed', 'sent', 'x', '2026-11', ? FROM bookings",
    )
      .bind(NOW)
      .run();
    const transport = vi.fn(async () => ({ ok: true as const }));
    const r = await notifyPurchase({ ...env, LINE_MESSAGING_TOKEN: 'tok' }, orderId, new Date(NOW), transport);
    expect(r).toEqual({ status: 'skipped', reason: 'monthly_limit' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('設定で止めているときは送らない', async () => {
    const orderId = await paidOrderId();
    await env.DB.prepare('DELETE FROM photo_notifications').run();
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_notify_purchase', 'false', ?)").bind(NOW).run();
    const transport = vi.fn(async () => ({ ok: true as const }));
    expect(await notifyPurchase({ ...env, LINE_MESSAGING_TOKEN: 'tok' }, orderId, new Date(NOW), transport)).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(transport).not.toHaveBeenCalled();
  });
});
