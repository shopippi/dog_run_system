import { formatAlbumDate, toJstDate, type AlbumStatus } from '@dr/shared';

// PA-3〜PA-5 の表示の小さな手伝い

/** 今日(日本時間の "2026-11-03") */
export const jstToday = () => toJstDate(new Date());

/** "2027-05-03T10:00:00+09:00" → "2027/05/03" */
export const formatJstDay = (iso: string) => formatAlbumDate(iso.slice(0, 10));

/** 一覧の販売終了の表示 */
export function saleEndLabel(status: AlbumStatus, saleEndsAt: string | null, today: string): string {
  if (status === 'draft') return '公開すると、販売期間が決まります';
  if (!saleEndsAt) return '販売終了の日はありません';
  const day = saleEndsAt.slice(0, 10);
  if (status === 'ended') return `${formatAlbumDate(day)}に販売終了`;
  return day < today ? `${formatAlbumDate(day)}に販売終了` : `${formatAlbumDate(day)}まで販売`;
}

/** 販売終了の日(日付の入力欄)を、その日の終わりの日時にする */
export const endOfDayIso = (ymd: string) => `${ymd}T23:59:00+09:00`;
