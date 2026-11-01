import { toJstDate, toJstIso } from '../date';
import type { AlbumKind, AlbumPhotoStatus } from './constants';

// 写真販売の決まり(純粋な関数。API・画面・デモで同じものを使う。docs/photo-requirements.md 3章)

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

// ---------------------------------------------------------------- 価格(PF-3)

/** 写真1枚の価格。写真ごとの例外価格 > 価格表の1枚の価格 */
export function resolvePhotoPrice(args: { priceOverride: number | null | undefined; unitPrice: number }): number {
  return args.priceOverride ?? args.unitPrice;
}

/** アルバムまるごとの価格。価格表に無ければ null(まるごとでは買えない) */
export function resolveAlbumPrice(args: { albumPrice: number | null | undefined }): number | null {
  return args.albumPrice ?? null;
}

/** 写真の価格が、価格表に従っているか(例外価格がないか) */
export const followsPriceList = (priceOverride: number | null | undefined) => priceOverride == null;

// ---------------------------------------------------------------- 販売期間(PF-1・PF-8)

/**
 * 日本時間の日時に、か月を足す(月末は、その月の最後の日に切る。8/31 + 6か月 = 2/28)。
 * 返すのは "2027-02-28T10:00:00+09:00" の形
 */
export function addMonthsJst(iso: string, months: number): string {
  const j = toJstIso(new Date(iso)); // 日本時間にそろえる
  const y = Number(j.slice(0, 4));
  const m = Number(j.slice(5, 7));
  const d = Number(j.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, last))}${j.slice(10)}`;
}

/** 販売終了の日時の既定 = 公開した日時 + 6か月(設定 photo_sale_months) */
export function defaultSaleEndsAt(publishedAt: string, saleMonths = 6): string {
  return addMonthsJst(publishedAt, saleMonths);
}

/** 販売中か(公開中で、販売終了の日時より前) */
export function isOnSale(album: { status: string; saleEndsAt: string | null }, now: Date): boolean {
  if (album.status !== 'published') return false;
  if (!album.saleEndsAt) return true;
  return now.getTime() < new Date(album.saleEndsAt).getTime();
}

/** 削除の前のお知らせを出す時期か(販売終了の noticeDays 日前から、終了まで) */
export function isDeletionNoticeDue(saleEndsAt: string, now: Date, noticeDays = 7): boolean {
  const end = new Date(saleEndsAt).getTime();
  return now.getTime() >= end - noticeDays * DAY_MS && now.getTime() < end;
}

// ---------------------------------------------------------------- まるごと購入の権利(PF-6)

export type AlbumPhotoForEntitlement = {
  photoId: number;
  status: AlbumPhotoStatus;
  /** その写真をこのアルバムで公開した日時 */
  publishedAt: string | null;
  /** ファイルを消した(販売終了)写真 */
  filesDeleted?: boolean;
};

/**
 * アルバムまるごと購入で、権利を作る写真。お支払いが確定した時点で公開中の写真だけ
 * (あとから足した写真・非公開・外した写真は含めない)。すでに持っている写真は足さない。
 */
export function albumEntitlementPhotoIds(
  photos: AlbumPhotoForEntitlement[],
  paidAt: string,
  ownedPhotoIds: Iterable<number> = [],
): number[] {
  const owned = new Set(ownedPhotoIds);
  const paid = new Date(paidAt).getTime();
  const out: number[] = [];
  for (const p of photos) {
    if (p.status !== 'published' || !p.publishedAt || p.filesDeleted) continue;
    if (new Date(p.publishedAt).getTime() > paid) continue;
    if (owned.has(p.photoId) || out.includes(p.photoId)) continue;
    out.push(p.photoId);
  }
  return out;
}

// ---------------------------------------------------------------- 返金(PF-6・PA-6)

export type RefundCheck =
  | { eligible: true; deadline: string }
  | { eligible: false; reason: 'not_paid' | 'already_refunded' | 'too_late' | 'downloaded'; deadline: string | null };

/** 返金できないときの、画面に出す理由(管理画面) */
export const REFUND_BLOCK_MESSAGES: Record<Exclude<RefundCheck, { eligible: true }>['reason'], string> = {
  not_paid: 'まだお支払いが確定していない注文です。',
  already_refunded: 'この明細は、もう返金しています。',
  too_late: '購入から7日を過ぎています。返金するときは、理由を書いて「条件の外で返金する」を選んでください。',
  downloaded: 'お客さんが、もうダウンロードしています。返金するときは、理由を書いて「条件の外で返金する」を選んでください。',
};

/**
 * 返金を受けられるか: 購入(お支払いの確定)から refundDays 日以内で、その明細の写真を一度もダウンロードしていないこと。
 * 条件の外でも、管理者は理由を書けば返金できる(操作ログに残す。この関数では判定しない)
 */
export function refundEligibility(args: {
  paidAt: string | null;
  refundedAt: string | null;
  /** この明細の写真が、一度でもダウンロードされたか */
  downloaded: boolean;
  now: Date;
  refundDays?: number;
}): RefundCheck {
  if (!args.paidAt) return { eligible: false, reason: 'not_paid', deadline: null };
  const deadline = toJstIso(new Date(new Date(args.paidAt).getTime() + (args.refundDays ?? 7) * DAY_MS));
  if (args.refundedAt) return { eligible: false, reason: 'already_refunded', deadline };
  if (args.now.getTime() > new Date(deadline).getTime()) return { eligible: false, reason: 'too_late', deadline };
  if (args.downloaded) return { eligible: false, reason: 'downloaded', deadline };
  return { eligible: true, deadline };
}

// ---------------------------------------------------------------- ダウンロードの回数(PF-7)

export type DownloadAllowance = { allowed: boolean; remaining: number; resetsAt: string | null };

/**
 * ダウンロードの回数の上限: 写真1枚につき、直近 hours 時間で count 回まで(既定 24時間で10回)。
 * previous は、その写真のこれまでのダウンロードの日時(古い順でなくてよい)
 */
export function downloadAllowance(
  previous: string[],
  now: Date,
  limit: { count: number; hours: number } = { count: 10, hours: 24 },
): DownloadAllowance {
  const windowStart = now.getTime() - limit.hours * HOUR_MS;
  const recent = previous
    .map((t) => new Date(t).getTime())
    .filter((t) => t > windowStart && t <= now.getTime())
    .sort((a, b) => a - b);
  const remaining = Math.max(0, limit.count - recent.length);
  // 枠が空くのは、窓の中でいちばん古い記録が窓から出たとき
  const resetsAt = remaining === 0 && recent.length > 0 ? toJstIso(new Date(recent[recent.length - limit.count]! + limit.hours * HOUR_MS)) : null;
  return { allowed: remaining > 0, remaining, resetsAt };
}

// ---------------------------------------------------------------- フォルダ名(PF-2)

export type ParsedFolder = { kind: AlbumKind; eventDate: string; name: string };

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * フォルダ名からアルバムを決める。
 * YYYY-MM-DD / YYYYMMDD / YYYY.MM.DD なら日付のアルバム(開催日 = その日、名前 = "2026/11/03")。
 * それ以外はイベントのアルバム(開催日 = 今日。あとで直せる。名前 = フォルダ名)
 */
export function parseFolderName(folder: string, now: Date): ParsedFolder {
  const name = folder.trim().replace(/\s+/g, ' ');
  const m = /^(\d{4})(?:-(\d{2})-(\d{2})|(\d{2})(\d{2})|\.(\d{2})\.(\d{2}))$/.exec(name);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2] ?? m[4] ?? m[6]);
    const d = Number(m[3] ?? m[5] ?? m[7]);
    if (validYmd(y, mo, d)) {
      return { kind: 'date', eventDate: `${y}-${pad(mo)}-${pad(d)}`, name: `${y}/${pad(mo)}/${pad(d)}` };
    }
  }
  return { kind: 'event', eventDate: toJstDate(now), name: name.slice(0, 60) || '名前のないアルバム' };
}

export type UploadFileClass = 'jpeg' | 'heic' | 'skip_hidden' | 'skip_type';

/** 一斉アップロードで送るファイルか。JPEG と HEIC だけ。隠しファイル・RAW・動画などは飛ばす(件数を出す) */
export function classifyUploadFile(name: string, type = ''): UploadFileClass {
  const base = name.split(/[\\/]/).pop() ?? name;
  if (base.startsWith('.') || base.startsWith('._') || base === 'Thumbs.db' || base === 'desktop.ini') return 'skip_hidden';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
  if (type === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif') return 'heic';
  return 'skip_type';
}

/** ファイル名の順(並び順の既定)。数字は数として比べる(IMG_2 < IMG_10) */
export function compareFileNames(a: string, b: string): number {
  return a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------- 表示

/** 透かしの文字。設定が空なら「施設の名前 SAMPLE」 */
export function photoWatermarkText(settings: { photo_watermark_text: string; facility_name: string }): string {
  return settings.photo_watermark_text.trim() || `${settings.facility_name} SAMPLE`;
}

/** 開催日の表示("2026-11-03" → "2026/11/03") */
export function formatAlbumDate(ymd: string): string {
  return ymd.replaceAll('-', '/');
}

/** 価格の表示("1,200円") */
export function formatPhotoPrice(yenAmount: number): string {
  return `${yenAmount.toLocaleString('ja-JP')}円`;
}

// ---------------------------------------------------------------- カートの合計(PF-6)

export type CartLine = { kind: 'photo' | 'album'; albumId: number; photoId?: number; unitPrice: number };

/** 合計(税込み・円)。金額はサーバーが DB から決めた unitPrice だけを使う */
export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPrice, 0);
}

export type CartLineState = 'ok' | 'redundant' | 'unavailable';
export type CartUnavailableReason = 'ended' | 'hidden' | 'not_found' | 'already_owned' | 'no_album_price';

/** カートの1行(サーバーの cart_items)と、いま買えるか(サーバーが DB から調べた結果) */
export type CartEntry = {
  id: number;
  kind: 'photo' | 'album';
  albumId: number;
  photoId: number | null;
  /** 買えないときの理由(販売終了・非公開・見つからない・購入済み・まるごとの価格がない)。買えるなら null */
  unavailable: CartUnavailableReason | null;
};

/**
 * カートの行ごとの状態(PF-6)。
 * - unavailable: 販売終了・非公開・購入済みなど。印を付けて見せ、購入手続きでは除く
 * - redundant: 同じカートに、その写真が入るアルバムまるごと(買えるもの)があるので、1枚の分は要らない。印を付けて見せ、二重に請求しない
 * - ok: 購入手続きに入れる
 * albumPhotoIds は、まるごとの行のアルバムの、いま公開中の写真(まるごと購入で権利が付く写真)
 */
export function cartLineStates(entries: CartEntry[], albumPhotoIds: Map<number, ReadonlySet<number>>): Map<number, CartLineState> {
  const coveringAlbums = entries.filter((e) => e.kind === 'album' && !e.unavailable).map((e) => e.albumId);
  const out = new Map<number, CartLineState>();
  for (const e of entries) {
    if (e.unavailable) out.set(e.id, 'unavailable');
    else if (
      e.kind === 'photo' &&
      coveringAlbums.some((a) => a === e.albumId || (e.photoId !== null && albumPhotoIds.get(a)?.has(e.photoId)))
    )
      out.set(e.id, 'redundant');
    else out.set(e.id, 'ok');
  }
  return out;
}

/** 購入手続きに入れる行(状態が ok のものだけ) */
export function checkoutEntries<T extends { id: number }>(entries: T[], states: Map<number, CartLineState>): T[] {
  return entries.filter((e) => states.get(e.id) === 'ok');
}

/** カートに入れる前に、同じものの重なりを除く(同じ写真は1回、同じアルバムのまるごとは1回) */
export function dedupeCartItems<T extends { kind: 'photo' | 'album'; albumId: number; photoId?: number }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.kind === 'album' ? `a:${i.albumId}` : `p:${i.photoId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
