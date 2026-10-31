import { bookingMessageText, bookingMonthOf, bookingWhenText, toJstIso, type BookingNotifyStatus } from '@dr/shared';
import type { Bindings } from '../env';
import { loadSettings } from '../lib/settings';
import { findBooking } from './bookings';

// 予約のお知らせ(LINE の Messaging API のプッシュメッセージ。要件定義書 21.6)。
// - 送るのは、予約が確定したとき(すぐ確定・承認)と、お断りしたときだけ。前日のお知らせなどは送らない
// - トークンがない・上限に達した・送れなかった(友だちに追加していない など)ときも、予約は止めない。結果を booking_notifications に残す
// - 本番(ENVIRONMENT = production)のときだけ LINE に送る。local・test では送らずに「送ったつもり」(reason = mock)で記録する
//   (テストで LINE を呼ばない。デモのトーク画面は、この記録から「このメッセージが届きます」を出す)

export const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

export type PushResult = { ok: true; mock?: boolean } | { ok: false; reason: 'not_friend' | 'http_error' | 'network'; detail: string };
/** 送り方。本番は LINE、local・test は送らない。テストでは fetch のまね(vi.fn)を差し込む */
export type PushTransport = (token: string, to: string, text: string) => Promise<PushResult>;

/** LINE に送る(本番) */
export function lineTransport(fetcher: typeof fetch = fetch): PushTransport {
  return async (token, to, text) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetcher(LINE_PUSH_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
        signal: controller.signal,
      });
      if (res.ok) return { ok: true };
      const body = (await res.text().catch(() => '')).slice(0, 500);
      // 友だちに追加していない・ブロックしている人には届かない(LINE は 400 などで返す)
      const notFriend = res.status === 400 || res.status === 403 || /friend|block/i.test(body);
      return { ok: false, reason: notFriend ? 'not_friend' : 'http_error', detail: `${res.status} ${body}` };
    } catch (e) {
      return { ok: false, reason: 'network', detail: String((e as Error)?.message ?? e).slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** local・test の送り方: 何も送らず、送ったつもりにする */
export const mockTransport: PushTransport = async () => ({ ok: true, mock: true });

export function transportFor(env: Pick<Bindings, 'ENVIRONMENT'>): PushTransport {
  return env.ENVIRONMENT === 'production' ? lineTransport() : mockTransport;
}

/** その月に送った数(ひと月の上限と、システムの状態の画面に使う) */
export async function sentThisMonth(db: D1Database, now: Date): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM booking_notifications WHERE month = ? AND status = 'sent'")
    .bind(bookingMonthOf(now))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * 予約のお知らせを送り、結果を記録する。失敗しても例外は投げない(予約は止めない)。
 * 送り先は、予約を申し込んだ家族(LINE アカウント)。その人がおうちにいなければ、送らない。
 */
export async function notifyBooking(
  env: Pick<Bindings, 'DB' | 'ENVIRONMENT' | 'LINE_MESSAGING_TOKEN'>,
  bookingId: number,
  kind: 'confirmed' | 'declined',
  now: Date,
  transport: PushTransport = transportFor(env),
): Promise<{ status: BookingNotifyStatus; reason: string | null }> {
  const db = env.DB;
  try {
    const settings = await loadSettings(db);
    const b = await findBooking(db, bookingId);
    const { results: dogs } = await db
      .prepare('SELECT d.name FROM booking_dogs bd JOIN dogs d ON d.id = bd.dog_id WHERE bd.booking_id = ? ORDER BY bd.id')
      .bind(b.id)
      .all<{ name: string }>();
    const text = bookingMessageText({
      kind,
      facilityName: settings.facility_name,
      service: b.service,
      when: bookingWhenText({ service: b.service, startDate: b.start_date, endDate: b.end_date, startTime: b.start_time, endTime: b.end_time }),
      dogNames: dogs.map((d) => d.name),
      estimateTotal: b.estimate_total,
      message: b.decision_message,
      link: settings.liff_id ? `https://liff.line.me/${settings.liff_id}/bookings/${b.id}` : null,
    });
    const recipient = b.requested_by_member_id
      ? await db
          .prepare(
            `SELECT m.id, m.line_user_id FROM family_members m JOIN households h ON h.id = m.household_id
              WHERE m.id = ? AND m.status = 'active' AND m.line_user_id IS NOT NULL`,
          )
          .bind(b.requested_by_member_id)
          .first<{ id: number; line_user_id: string }>()
      : null;

    const record = async (status: BookingNotifyStatus, reason: string | null, detail: string | null = null) => {
      await db
        .prepare(
          `INSERT INTO booking_notifications (booking_id, kind, member_id, status, reason, detail, message, month, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(b.id, kind, recipient?.id ?? null, status, reason, detail, text, bookingMonthOf(now), toJstIso(now))
        .run();
      return { status, reason };
    };

    if (!settings.booking_notify[kind]) return record('skipped', 'disabled');
    if (b.source === 'staff') return record('skipped', 'manual_entry');
    if (!recipient) return record('skipped', 'no_recipient');
    if ((await sentThisMonth(db, now)) >= settings.booking_notify.monthly_limit) return record('skipped', 'monthly_limit');
    const token = env.LINE_MESSAGING_TOKEN?.trim();
    if (!token) return record('skipped', 'no_token');
    const r = await transport(token, recipient.line_user_id, text);
    if (r.ok) return record('sent', r.mock ? 'mock' : null);
    return record('failed', r.reason, r.detail);
  } catch (e) {
    console.error('予約のお知らせを記録できませんでした', e);
    return { status: 'failed', reason: 'internal' };
  }
}

// ---------------------------------------------------------------
// トークンが使えるかの確かめ(システムの状態。GET /v2/bot/info)
// ---------------------------------------------------------------

export const LINE_BOT_INFO_URL = 'https://api.line.me/v2/bot/info';
export type LineBotState = { state: 'connected' | 'not_set' | 'error' | 'mock'; displayName: string | null; basicId: string | null; message: string };

/** 少しのあいだ(5分)覚えておく。トークンが変われば確かめ直す */
const BOT_CACHE_MS = 5 * 60_000;
let botCache: { token: string; at: number; value: LineBotState } | null = null;

/**
 * LINE 公式アカウントにつながるかを確かめる。トークンは画面にもログにも出さない。
 * 本番だけ LINE に問い合わせる。local・test は「練習用の環境なので確かめていない」。テストでは fetcher を差し込む
 */
export async function lineBotInfo(
  env: Pick<Bindings, 'ENVIRONMENT' | 'LINE_MESSAGING_TOKEN'>,
  opts: { fetcher?: typeof fetch; force?: boolean; now?: number } = {},
): Promise<LineBotState> {
  const token = env.LINE_MESSAGING_TOKEN?.trim();
  if (!token) {
    return {
      state: 'not_set',
      displayName: null,
      basicId: null,
      message: 'LINEのお知らせの設定がまだです。予約はそのまま使えます。お知らせを送るときは、製作者にトークンの設定を頼んでください(docs/deploy.md)。',
    };
  }
  if (env.ENVIRONMENT !== 'production' && !opts.fetcher) {
    return { state: 'mock', displayName: null, basicId: null, message: '練習用の環境のため、LINEには確かめていません(送ったつもりで記録します)。' };
  }
  const now = opts.now ?? Date.now();
  if (!opts.force && botCache && botCache.token === token && now - botCache.at < BOT_CACHE_MS) return botCache.value;
  let value: LineBotState;
  try {
    const res = await (opts.fetcher ?? fetch)(LINE_BOT_INFO_URL, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) {
      const info = (await res.json()) as { displayName?: string; basicId?: string };
      value = { state: 'connected', displayName: info.displayName ?? null, basicId: info.basicId ?? null, message: 'LINE公式アカウントにつながっています。' };
    } else if (res.status === 401 || res.status === 403) {
      value = {
        state: 'error',
        displayName: null,
        basicId: null,
        message: `LINEにつながりませんでした(${res.status})。トークンが正しくないか、発行し直して古くなっています。LINE Developers でトークンを発行し直し、GitHub の Secret「LINE_MESSAGING_TOKEN」を入れ直して配信し直してください。`,
      };
    } else {
      value = { state: 'error', displayName: null, basicId: null, message: `LINEにつながりませんでした(${res.status})。しばらくしてから、この画面を開き直してください。続くときは製作者に知らせてください。` };
    }
  } catch {
    value = { state: 'error', displayName: null, basicId: null, message: 'LINEにつながりませんでした。しばらくしてから、この画面を開き直してください。' };
  }
  botCache = { token, at: now, value };
  return value;
}
