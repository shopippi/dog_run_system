import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from '../src/lib/settings';
import { createBooking } from '../src/services/bookings';
import { lineTransport, notifyBooking } from '../src/services/line-push';
import { call, dog, registerUser } from './helpers';

// C-15 予約する・C-16 予約の一覧とキャンセル(要件定義書 21章)

const NOW = '2026-10-31T10:00:00+09:00';
const DAY = '2026-11-04'; // 水曜

const daycare = (dogIds: number[], extra: Record<string, unknown> = {}) => ({
  service: 'daycare',
  startDate: DAY,
  endDate: DAY,
  startTime: '10:00',
  endTime: '16:00',
  dogIds,
  note: 'ごはんは朝だけ',
  checklist: ['狂犬病の予防注射と混合ワクチンを、1年以内に受けています', 'ノミ・ダニの予防をしています'],
  ...extra,
});

const book = (user: string, body: unknown, opts: { now?: string; key?: string } = {}) =>
  call('/api/bookings', { user, body, now: opts.now ?? NOW, headers: opts.key ? { 'idempotency-key': opts.key } : undefined });

/** 預かりの経験ありにする(テストの準備) */
async function markExperienced(dogId: number) {
  await env.DB.prepare("UPDATE dogs SET stay_experience_at = '2026-01-01T00:00:00+09:00' WHERE id = ?").bind(dogId).run();
}

async function bookingRows() {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings').first<{ n: number }>())!.n;
}

afterEach(() => vi.restoreAllMocks());

describe('予約の画面の準備', () => {
  it('選べるワンちゃん(預かりの経験・予防注射の案内)と、料金などの設定を返す', async () => {
    const u = await registerUser('U001:ママ', [dog('こむぎ', { rabiesVaccineYear: 2026, comboVaccineYear: 2026 }), dog('だいず')]);
    await markExperienced(u.dogs[0]!.id);
    const r = await call('/api/bookings/options', { user: 'U001:ママ', now: NOW });
    expect(r.status).toBe(200);
    expect(r.body.today).toBe('2026-10-31');
    expect(r.body.dogs).toHaveLength(2);
    expect(r.body.dogs[0]).toMatchObject({ name: 'こむぎ', experienced: true, vaccineNotice: null });
    expect(r.body.dogs[1]).toMatchObject({ name: 'だいず', experienced: false });
    expect(r.body.dogs[1].vaccineNotice).toContain('だいずは');
    expect(r.body.rules.booking_prices.daycare).toEqual({ small: 3000, medium: 4000, large: 5000 });
    expect(r.body.rules.booking_prices.boarding).toEqual({ small: 10000, medium: 12500, large: 15000 });
  });

  it('LINE の IDトークンがなければ 401', async () => {
    const r = await call('/api/bookings/options', { now: NOW });
    expect(r.status).toBe(401);
  });
});

describe('すぐ確定か、確認待ちか', () => {
  it('預かりの経験がある子だけなら、すぐ確定。料金の目安と内訳が付く', async () => {
    const u = await registerUser('U001:ママ');
    await markExperienced(u.dogs[0]!.id);
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'confirmed', approvalReason: null, estimateTotal: 3000, canCancel: true });
    expect(r.body.estimate.lines[0]).toMatchObject({ dogName: 'アル', amount: 3000 });
    expect(r.body.cancelDeadline).toBe('2026-11-03T18:00:00+09:00');
    expect(r.body.requestedBy).toBe('ママ');
  });

  it('はじめての子がいれば確認待ち', async () => {
    const u = await registerUser('U001:ママ', [dog('こむぎ'), dog('だいず')]);
    await markExperienced(u.dogs[0]!.id);
    const r = await book('U001:ママ', daycare(u.dogs.map((d) => d.id)));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending', approvalReason: 'first_time' });
    expect(r.body.dogs.map((d: { firstTime: boolean }) => d.firstTime)).toEqual([false, true]);
  });

  it('「すべて承認制にする」なら、経験のある子でも確認待ち', async () => {
    const u = await registerUser('U001:ママ');
    await markExperienced(u.dogs[0]!.id);
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('booking_approve_all', 'true', 'x')").run();
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    expect(r.body).toMatchObject({ status: 'pending', approvalReason: 'approve_all' });
  });

  it('受付でお預かりした(利用開始にした)子は、次からすぐ確定', async () => {
    const u = await registerUser('U001:ママ');
    const first = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    expect(first.body.status).toBe('pending');
    await env.DB.prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").bind(first.body.id).run();
    const next = await book('U001:ママ', daycare([u.dogs[0]!.id], { startDate: '2026-11-06', endDate: '2026-11-06' }));
    expect(next.body.status).toBe('confirmed');
  });

  it('確かめてもらうことに印がないと予約できない', async () => {
    const u = await registerUser('U001:ママ');
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id], { checklist: [] }));
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('すべてに印');
  });

  it('ほかのおうちのワンちゃんは選べない', async () => {
    await registerUser('U001:ママ');
    const other = await registerUser('U002:よそ');
    const r = await book('U001:ママ', daycare([other.dogs[0]!.id]));
    expect(r.status).toBe(400);
  });

  it('同じ子の予約が重なるときは 409(変えるときはキャンセルしてから入れ直す)', async () => {
    const u = await registerUser('U001:ママ');
    await book('U001:ママ', daycare([u.dogs[0]!.id]));
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id], { startTime: '11:00' }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('booking_duplicate');
  });
});

describe('受け入れ数(サイズごと・日ごと)', () => {
  async function largeHouseholds(n: number) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = await registerUser(`UL${i}:大型${i}`, [dog(`ラブ${i}`, { breedId: 9, size: 'large' })]);
      out.push(u.dogs[0]!.id);
    }
    return out;
  }

  it('大型は1日2頭まで。3頭目は満員で予約できない。小型は空いている', async () => {
    const ids = await largeHouseholds(3);
    expect((await book('UL0:大型0', daycare([ids[0]!]))).status).toBe(201);
    expect((await book('UL1:大型1', daycare([ids[1]!]))).status).toBe(201);
    const third = await book('UL2:大型2', daycare([ids[2]!]));
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('booking_full');
    expect(third.body.error.details.dates[0]).toMatchObject({ date: DAY, size: 'large', caps: 2, used: 2, need: 1 });

    const av = await call(`/api/bookings/availability?service=daycare&from=${DAY}&to=2026-11-05&dogIds=${ids[2]}`, { user: 'UL2:大型2', now: NOW });
    expect(av.body.days).toEqual([
      { date: DAY, status: 'full' },
      { date: '2026-11-05', status: 'open' },
    ]);
    const small = await registerUser('US:小型');
    const av2 = await call(`/api/bookings/availability?service=daycare&from=${DAY}&to=${DAY}&dogIds=${small.dogs[0]!.id}`, { user: 'US:小型', now: NOW });
    expect(av2.body.days[0].status).toBe('open');
    expect((await book('US:小型', daycare([small.dogs[0]!.id]))).status).toBe(201);
  });

  it('残りが1頭なら「残りわずか」。今日・受付期間の外は選べない', async () => {
    const ids = await largeHouseholds(2);
    await book('UL0:大型0', daycare([ids[0]!]));
    const av = await call(`/api/bookings/availability?service=daycare&from=2026-10-31&to=${DAY}&dogIds=${ids[1]}`, { user: 'UL1:大型1', now: NOW });
    const byDate = Object.fromEntries(av.body.days.map((d: { date: string; status: string }) => [d.date, d.status]));
    expect(byDate['2026-10-31']).toBe('out');
    expect(byDate[DAY]).toBe('few');
  });

  it('確認待ちも枠を押さえる。お断り・キャンセルで空く', async () => {
    const ids = await largeHouseholds(3);
    const a = await book('UL0:大型0', daycare([ids[0]!]));
    const b = await book('UL1:大型1', daycare([ids[1]!]));
    expect([a.body.status, b.body.status]).toEqual(['pending', 'pending']);
    expect((await book('UL2:大型2', daycare([ids[2]!]))).status).toBe(409);
    // お客さんがキャンセルすると空く
    expect((await call(`/api/bookings/${a.body.id}/cancel`, { user: 'UL0:大型0', body: {}, now: NOW })).body.status).toBe('cancelled');
    expect((await book('UL2:大型2', daycare([ids[2]!]))).status).toBe(201);
  });

  it('お泊まりは泊まる夜ごとに数える。チェックアウトの日は数えない', async () => {
    const ids = await largeHouseholds(3);
    const stay = (from: string, to: string) => ({ ...daycare([]), service: 'boarding', startDate: from, endDate: to });
    expect((await book('UL0:大型0', { ...stay('2026-11-03', '2026-11-05'), dogIds: [ids[0]] })).status).toBe(201);
    expect((await book('UL1:大型1', { ...stay('2026-11-04', '2026-11-06'), dogIds: [ids[1]] })).status).toBe(201);
    // 11/4 の夜が2頭でいっぱい
    expect((await book('UL2:大型2', { ...stay('2026-11-04', '2026-11-05'), dogIds: [ids[2]] })).status).toBe(409);
    // 11/5 にチェックインなら、11/5 の夜は1頭だけ
    const ok = await book('UL2:大型2', { ...stay('2026-11-05', '2026-11-07'), dogIds: [ids[2]] });
    expect(ok.status).toBe(201);
    expect(ok.body.estimate).toMatchObject({ nights: 2, total: 30000 });
  });

  it('その日を休みにする・受け入れ数を減らす(上書き)', async () => {
    const u = await registerUser('U001:ママ');
    await env.DB.prepare(
      "INSERT INTO booking_capacity_overrides (date, service, closed, created_at) VALUES (?, 'daycare', 1, 'x')",
    ).bind(DAY).run();
    const av = await call(`/api/bookings/availability?service=daycare&from=${DAY}&to=${DAY}&dogIds=${u.dogs[0]!.id}`, { user: 'U001:ママ', now: NOW });
    expect(av.body.days[0].status).toBe('closed');
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('booking_closed');
    // 預かりの上書きは、お泊まりには関係ない
    const av2 = await call(`/api/bookings/availability?service=boarding&from=${DAY}&to=${DAY}&dogIds=${u.dogs[0]!.id}`, { user: 'U001:ママ', now: NOW });
    expect(av2.body.days[0].status).toBe('open');
  });

  it('臨時休業の日は休み', async () => {
    const u = await registerUser('U001:ママ');
    await env.DB.prepare("INSERT INTO calendar (date, weekday, day_type, is_closed, updated_at) VALUES (?, 3, 'weekday', 1, 'x')").bind(DAY).run();
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    expect(r.status).toBe(409);
  });
});

describe('最後の1枠を同時に取らない', () => {
  it('2人が同時に最後の1枠を予約しても、1人だけが通る', async () => {
    const a = await registerUser('UA:A', [dog('ラブA', { breedId: 9, size: 'large' })]);
    const b = await registerUser('UB:B', [dog('ラブB', { breedId: 9, size: 'large' })]);
    const c = await registerUser('UC:C', [dog('ラブC', { breedId: 9, size: 'large' })]);
    await book('UA:A', daycare([a.dogs[0]!.id]));
    const [r1, r2] = await Promise.all([book('UB:B', daycare([b.dogs[0]!.id])), book('UC:C', daycare([c.dogs[0]!.id]))]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM booking_dogs bd JOIN bookings b ON b.id = bd.booking_id WHERE b.status IN ('pending','confirmed') AND bd.size = 'large'",
    ).first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it('先の確かめをすり抜けても、見張り(booking_guard)が受け入れ数を超える予約を取り消す', async () => {
    const a = await registerUser('UA:A', [dog('ラブA', { breedId: 9, size: 'large' })]);
    const b = await registerUser('UB:B', [dog('ラブB', { breedId: 9, size: 'large' }), dog('ラブB2', { breedId: 9, size: 'large' })]);
    await book('UA:A', daycare([a.dogs[0]!.id]));
    const hh = await env.DB.prepare("SELECT id FROM households WHERE member_no = ?").bind(b.memberNo).first<{ id: number }>();
    const settings = await loadSettings(env.DB);
    const before = await bookingRows();
    await expect(
      createBooking(
        env.DB,
        settings,
        {
          householdId: hh!.id,
          service: 'daycare',
          startDate: DAY,
          endDate: DAY,
          startTime: '10:00',
          endTime: '16:00',
          dogIds: b.dogs.map((d) => d.id),
          note: null,
          checklist: [],
          source: 'customer',
          memberId: null,
          staffId: null,
          now: new Date(NOW),
        },
        { skipPrecheck: true },
      ),
    ).rejects.toMatchObject({ code: 'booking_full', status: 409 });
    // 予約の行も、ワンちゃんの行も、操作ログも残らない(batch ごと取り消される)
    expect(await bookingRows()).toBe(before);
    const dogsRows = await env.DB.prepare('SELECT COUNT(*) AS n FROM booking_dogs').first<{ n: number }>();
    expect(dogsRows!.n).toBe(1);
  });
});

describe('電波が弱くて送り直しても、二重に予約しない', () => {
  it('同じ送信の印なら、2回目は1回目の応答をそのまま返す', async () => {
    const u = await registerUser('U001:ママ');
    const key = 'booking-key-0001';
    const r1 = await book('U001:ママ', daycare([u.dogs[0]!.id]), { key });
    const r2 = await book('U001:ママ', daycare([u.dogs[0]!.id]), { key });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.body.id).toBe(r1.body.id);
    expect(await bookingRows()).toBe(1);
  });
});

describe('予約の一覧とキャンセル(C-16)', () => {
  it('これからの予約と終わった予約に分ける', async () => {
    const u = await registerUser('U001:ママ');
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    const list = await call('/api/bookings', { user: 'U001:ママ', now: NOW });
    expect(list.body.upcoming.map((b: { id: number }) => b.id)).toEqual([r.body.id]);
    const later = await call('/api/bookings', { user: 'U001:ママ', now: '2026-11-05T10:00:00+09:00' });
    expect(later.body.upcoming).toHaveLength(0);
    expect(later.body.past).toHaveLength(1);
  });

  it('期限(前の日の18:00)まではキャンセルできる。過ぎたらお店に連絡してもらう', async () => {
    const u = await registerUser('U001:ママ');
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    const late = await call(`/api/bookings/${r.body.id}/cancel`, { user: 'U001:ママ', body: {}, now: '2026-11-03T18:00:01+09:00' });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toContain('お店に直接ご連絡ください');
    const detail = await call(`/api/bookings/${r.body.id}`, { user: 'U001:ママ', now: '2026-11-03T18:30:00+09:00' });
    expect(detail.body.canCancel).toBe(false);
    const ok = await call(`/api/bookings/${r.body.id}/cancel`, { user: 'U001:ママ', body: {}, now: '2026-11-03T17:59:00+09:00' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('cancelled');
    // 行は消さない
    expect(await bookingRows()).toBe(1);
  });

  it('ほかのおうちの予約は見られない', async () => {
    const u = await registerUser('U001:ママ');
    await registerUser('U002:よそ');
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    expect((await call(`/api/bookings/${r.body.id}`, { user: 'U002:よそ', now: NOW })).status).toBe(404);
    expect((await call(`/api/bookings/${r.body.id}/cancel`, { user: 'U002:よそ', body: {}, now: NOW })).status).toBe(404);
  });

  it('同じおうちの家族は、ほかの家族の予約も見られる', async () => {
    const u = await registerUser('U001:ママ');
    const { addFamily } = await import('./helpers');
    await addFamily(u.memberNo, 'U009', 'パパ');
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    const d = await call(`/api/bookings/${r.body.id}`, { user: 'U009:パパ', now: NOW });
    expect(d.status).toBe(200);
    expect(d.body.requestedBy).toBe('ママ');
  });
});

describe('LINE のお知らせ(確定・お断りだけ)', () => {
  it('テストの環境では LINE を呼ばない。トークンがなければ「送っていません」と記録し、予約は確定のまま', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const u = await registerUser('U001:ママ');
    await markExperienced(u.dogs[0]!.id);
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    expect(r.body.status).toBe('confirmed');
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('api.line.me'))).toHaveLength(0);
    const n = await env.DB.prepare('SELECT kind, status, reason FROM booking_notifications WHERE booking_id = ?').bind(r.body.id).first();
    expect(n).toMatchObject({ kind: 'confirmed', status: 'skipped', reason: 'no_token' });
  });

  it('確認待ちのときは送らない', async () => {
    const u = await registerUser('U001:ママ');
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    expect(r.body.status).toBe('pending');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM booking_notifications').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  async function confirmedBooking() {
    const u = await registerUser('U001:ママ');
    await markExperienced(u.dogs[0]!.id);
    const r = await book('U001:ママ', daycare([u.dogs[0]!.id]));
    return r.body.id as number;
  }

  it('トークンがあれば、Messaging API のプッシュで送る(送った)', async () => {
    const id = await confirmedBooking();
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const r = await notifyBooking({ DB: env.DB, ENVIRONMENT: 'production', LINE_MESSAGING_TOKEN: 'tok' }, id, 'confirmed', new Date(NOW), lineTransport(fetcher as unknown as typeof fetch));
    expect(r).toEqual({ status: 'sent', reason: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(String(init.body));
    expect(body.to).toBe('U001');
    expect(body.messages[0].text).toContain('預かりのご予約が確定しました');
    expect(body.messages[0].text).toContain('3,000円(目安。お支払いは受付で)');
  });

  it('友だちに追加していないなどで送れなかったら「送れなかった」と理由を記録する(予約はそのまま)', async () => {
    const id = await confirmedBooking();
    const fetcher = vi.fn(async () => new Response('{"message":"The user hasn\'t added the LINE Official Account as a friend."}', { status: 400 }));
    const r = await notifyBooking({ DB: env.DB, ENVIRONMENT: 'production', LINE_MESSAGING_TOKEN: 'tok' }, id, 'confirmed', new Date(NOW), lineTransport(fetcher as unknown as typeof fetch));
    expect(r).toEqual({ status: 'failed', reason: 'not_friend' });
    const b = await env.DB.prepare('SELECT status FROM bookings WHERE id = ?').bind(id).first<{ status: string }>();
    expect(b!.status).toBe('confirmed');
  });

  it('LINE につながらなかったときも「送れなかった」', async () => {
    const id = await confirmedBooking();
    const fetcher = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const r = await notifyBooking({ DB: env.DB, ENVIRONMENT: 'production', LINE_MESSAGING_TOKEN: 'tok' }, id, 'confirmed', new Date(NOW), lineTransport(fetcher as unknown as typeof fetch));
    expect(r).toEqual({ status: 'failed', reason: 'network' });
  });

  it('トークンがない・送らない設定・ひと月の上限では送らない(送っていません)', async () => {
    const id = await confirmedBooking();
    const fetcher = vi.fn(async () => new Response('{}'));
    const t = lineTransport(fetcher as unknown as typeof fetch);
    expect(await notifyBooking({ DB: env.DB, ENVIRONMENT: 'production' }, id, 'confirmed', new Date(NOW), t)).toEqual({ status: 'skipped', reason: 'no_token' });
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('booking_notify', '{"confirmed":true,"declined":false,"monthly_limit":1}', 'x')`,
    ).run();
    expect(await notifyBooking({ DB: env.DB, ENVIRONMENT: 'production', LINE_MESSAGING_TOKEN: 't' }, id, 'declined', new Date(NOW), t)).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(await notifyBooking({ DB: env.DB, ENVIRONMENT: 'production', LINE_MESSAGING_TOKEN: 't' }, id, 'confirmed', new Date(NOW), t)).toEqual({ status: 'sent', reason: null });
    expect(await notifyBooking({ DB: env.DB, ENVIRONMENT: 'production', LINE_MESSAGING_TOKEN: 't' }, id, 'confirmed', new Date(NOW), t)).toEqual({ status: 'skipped', reason: 'monthly_limit' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('local・test の環境では、トークンがあっても送らずに「送ったつもり」(mock)にする', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const id = await confirmedBooking();
    const r = await notifyBooking({ DB: env.DB, ENVIRONMENT: 'test', LINE_MESSAGING_TOKEN: 'tok' }, id, 'confirmed', new Date(NOW));
    expect(r).toEqual({ status: 'sent', reason: 'mock' });
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('api.line.me'))).toHaveLength(0);
  });
});
