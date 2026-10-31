import {
  BOOKING_SERVICE_LABELS,
  DOG_SIZE_LABELS,
  SCHEDULE_KIND_LABELS,
  type BookingScheduleResponse,
} from '@dr/shared';
import { useState } from 'react';
import { DogFace } from '../../components/DogFace';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Loading, SkeletonText } from '../../components/Skeleton';
import { useLoad } from '../../hooks/useLoad';
import { adminApi } from '../../lib/api';
import { BookingDialog } from './BookingDialog';
import { BookingStatusBadge } from './parts';

/**
 * その日の預け・お迎え(お店の1日の予定。21.5)。預かりの預け・お迎えと、お泊まりのチェックイン・チェックアウトを時刻の順に。
 * ワンちゃんの名前・犬種・サイズ(LINEで登録したもの)、おうち・飼い主(家族の名前)、メモ。押すと予約の内容が開く。
 * 受付スタッフ・製作者も見られる(操作は予約の内容のダイアログで、権限どおり)。
 * hideWhenEmpty のときは、予定がなければ何も出さない(今日の来場の画面)
 */
export function BookingSchedule({
  date,
  title,
  hideWhenEmpty = false,
  reloadKey = 0,
  onChanged,
}: {
  date: string;
  title: string;
  hideWhenEmpty?: boolean;
  reloadKey?: number;
  onChanged?: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const s = useLoad(() => adminApi<BookingScheduleResponse>(`/bookings/schedule?date=${date}`), [date, reloadKey, tick]);
  if (hideWhenEmpty && (!s.data || s.data.items.length === 0)) return null;
  const byId = new Map((s.data?.bookings ?? []).map((b) => [b.id, b]));
  return (
    <section className="panel bk-sched" aria-label={title}>
      <h2 className="bk-sched-title">{title}</h2>
      {s.error ? <ErrorNotice error={s.error} onRetry={() => void s.reload()} /> : null}
      {!s.data ? (
        !s.error && (
          <Loading>
            <div className="bk-sched-sk">
              <SkeletonText size={14} lines={2} />
            </div>
          </Loading>
        )
      ) : s.data.items.length === 0 ? (
        <p className="empty">この日の預け・お迎えはありません。</p>
      ) : (
        <ul className="bk-sched-list">
          {s.data.items.map((it) => {
            const b = byId.get(it.bookingId)!;
            return (
              <li key={`${it.bookingId}-${it.kind}`}>
                <button
                  type="button"
                  className="bk-sched-row"
                  onClick={() => setOpenId(b.id)}
                  aria-label={`${it.time.replace(/^0/, '')} ${SCHEDULE_KIND_LABELS[it.kind]} ${b.dogs.map((d) => d.name).join('・')}(${b.householdName})`}
                >
                  <span className="bk-sched-time mono">{it.time.replace(/^0/, '')}</span>
                  <span className={`bk-sched-kind${it.kind === 'pickup' || it.kind === 'checkout' ? ' out' : ''}`}>
                    {it.kind === 'dropoff' ? '預け' : it.kind === 'pickup' ? 'お迎え' : it.kind === 'checkin' ? '預け(お泊まり)' : 'お迎え(お泊まり)'}
                  </span>
                  <span className="stack">
                    {b.dogs.slice(0, 3).map((d) => (
                      <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
                    ))}
                  </span>
                  <span className="bk-adm-body">
                    <b>{b.dogs.map((d) => `${d.name}(${d.breedName}・${DOG_SIZE_LABELS[d.size]})`).join('・')}</b>
                    <span className="sub-text">
                      {b.householdName}
                      {b.ownerNames.length > 0 ? ` · ${b.ownerNames.join('、')}さん` : ''} · {BOOKING_SERVICE_LABELS[b.service]}
                    </span>
                    {b.note && <span className="sub-text bk-adm-note">メモ: {b.note}</span>}
                  </span>
                  <span className="badges">{b.status === 'pending' && <BookingStatusBadge status={b.status} />}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {openId !== null && (
        <BookingDialog
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            setTick((t) => t + 1);
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}
