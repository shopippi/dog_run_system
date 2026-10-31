import {
  BOOKING_SERVICE_LABELS,
  DOG_SIZE_LABELS,
  addDays,
  formatBookingDate,
  toJstDate,
  weekdayOf,
  type AdminBookingListResponse,
  type BookingCalendarResponse,
  type BookingDayResponse,
  type BookingService,
  type BookingRules,
  bookingHoursText,
} from '@dr/shared';
import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BusyLabel } from '../../components/BusyLabel';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { PageHead } from '../../components/PageHead';
import { Loading, Skeleton, SkeletonText } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useLoad } from '../../hooks/useLoad';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { BookingDialog } from './BookingDialog';
import { BookingRowButton, SizeUsage } from './parts';
import { BookingSchedule } from './BookingSchedule';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
const weekStart = (d: string) => addDays(d, -weekdayOf(d));

/**
 * M-20 予約カレンダー(A-18)。サービスごとに、月か週で、サイズごとの「使っている数 / 受け入れ数」と予約の数を出す。
 * 日を押すと、その日の予約(おうち・ワンちゃんの写真とサイズ・メモ・状態)。管理者は、その日の受け入れ数を変えられる(A-22)。
 */
export function BookingCalendarPage() {
  const [params, setParams] = useSearchParams();
  const service: BookingService = params.get('service') === 'boarding' ? 'boarding' : 'daycare';
  const today = toJstDate(new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const initial = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : null;
  const [month, setMonth] = useState((initial ?? today).slice(0, 7));
  const [week, setWeek] = useState(weekStart(initial ?? today));
  const [date, setDate] = useState<string | null>(initial);
  const [openId, setOpenId] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const from = view === 'month' ? `${month}-01` : week;
  const to = view === 'month' ? monthEnd(month) : addDays(week, 6);
  const cal = useLoad(() => adminApi<BookingCalendarResponse>(`/bookings/calendar?service=${service}&from=${from}&to=${to}`), [service, from, to, tick]);
  const weekList = useLoad(
    () => (view === 'week' ? adminApi<AdminBookingListResponse>(`/bookings?service=${service}&from=${from}&to=${to}`) : Promise.resolve(null)),
    [service, from, to, view, tick],
  );
  const changed = () => setTick((t) => t + 1);
  const { staff, readOnly } = useAuth();
  const opts = useLoad(() => adminApi<{ today: string; rules: BookingRules }>('/bookings/options'), []);

  const setService = (s: BookingService) => {
    const p = new URLSearchParams(params);
    p.set('service', s);
    setParams(p, { replace: true });
  };
  const shift = (k: number) => (view === 'month' ? setMonth(shiftMonth(month, k)) : setWeek(addDays(week, 7 * k)));
  const [y, m] = (view === 'month' ? month : week).split('-').map(Number);
  const label = view === 'month' ? `${y}年${m}月` : `${formatBookingDate(week)} 〜 ${formatBookingDate(addDays(week, 6))}`;
  const days = cal.data?.days ?? null;

  return (
    <div className="page bk-page">
      <PageHead
        title="予約カレンダー"
        howto="預かり・お泊まりの予約を、日ごとに見られます。マスの「小 2/5」は、小型の予約の数 / 受け入れる頭数です。日を押すと、その日の予約が出ます。"
        aside={
          <div className="bk-head-acts">
            {staff?.role === 'admin' && !readOnly && (
              <Link to="/booking-settings" className="btn ghost">
                予約の設定
              </Link>
            )}
            {!readOnly && (
              <Link to="/bookings/new" className="btn sub">
                予約を入れる
              </Link>
            )}
            <Link to="/bookings/pending" className="btn sub">
              確認待ち{cal.data ? ` ${cal.data.pendingTotal}件` : ''}
            </Link>
          </div>
        }
      />
      <div className="bk-toolbar">
        <div className="segment" role="tablist" aria-label="予約の種類">
          {(['daycare', 'boarding'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={service === s} onClick={() => setService(s)}>
              {BOOKING_SERVICE_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="segment" role="tablist" aria-label="表示">
          <button type="button" role="tab" aria-selected={view === 'month'} onClick={() => setView('month')}>
            月
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'week'}
            onClick={() => {
              setWeek(weekStart(date ?? (month === today.slice(0, 7) ? today : `${month}-01`)));
              setView('week');
            }}
          >
            週
          </button>
        </div>
        <div className="bk-nav">
          <button type="button" className="btn ghost icon-btn" aria-label={view === 'month' ? '前の月' : '前の週'} onClick={() => shift(-1)}>
            <Icon name="chevron-left" />
          </button>
          <span className="bk-nav-label" aria-live="polite">
            {label}
          </span>
          <button type="button" className="btn ghost icon-btn" aria-label={view === 'month' ? '次の月' : '次の週'} onClick={() => shift(1)}>
            <Icon name="chevron-right" />
          </button>
        </div>
      </div>

      {opts.data && (
        <p className="bk-hours" data-testid="booking-hours">
          {bookingHoursText(opts.data.rules)}
          {staff?.role === 'admin' && !readOnly && (
            <>
              {' '}
              <Link to="/booking-settings">変える</Link>
            </>
          )}
        </p>
      )}
      {cal.error ? <ErrorNotice error={cal.error} onRetry={() => void cal.reload()} /> : null}

      <section className="panel bk-cal-panel" aria-label={`${label}の${BOOKING_SERVICE_LABELS[service]}のカレンダー`}>
        {view === 'month' ? (
          <div className="bk-month" role="grid">
            {WEEK.map((w) => (
              <span key={w} className="bk-wd" role="columnheader">
                {w}
              </span>
            ))}
            {Array.from({ length: weekdayOf(`${month}-01`) }, (_, i) => (
              <span key={`e${i}`} className="bk-day empty" aria-hidden="true" />
            ))}
            {!days
              ? Array.from({ length: Number(monthEnd(month).slice(8)) }, (_, i) => (
                  <span key={i} className="bk-day">
                    <Skeleton w={20} h={14} r={4} />
                    <Skeleton w="80%" h={12} r={4} />
                  </span>
                ))
              : days.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    role="gridcell"
                    className={`bk-day${d.date === date ? ' on' : ''}${d.date === today ? ' today' : ''}${d.closed ? ' closed' : ''}`}
                    aria-pressed={d.date === date}
                    aria-label={`${formatBookingDate(d.date)} 予約${d.bookings}件${d.pending ? `・確認待ち${d.pending}件` : ''}${d.closed ? '・休み' : ''}`}
                    data-date={d.date}
                    onClick={() => setDate(d.date)}
                  >
                    <span className="bk-day-top">
                      <b>{Number(d.date.slice(8))}</b>
                      {d.overridden && !d.closed && <span className="bk-day-mark">変更</span>}
                    </span>
                    <SizeUsage used={d.used} caps={d.caps} closed={d.closed} />
                    <span className="bk-day-count">
                      {d.bookings > 0 ? `${d.bookings}件` : ''}
                      {d.pending > 0 ? `・確認待ち${d.pending}` : ''}
                    </span>
                  </button>
                ))}
          </div>
        ) : (
          <div className="bk-week">
            {Array.from({ length: 7 }, (_, i) => {
              const d = addDays(week, i);
              const c = days?.find((x) => x.date === d);
              const items = (weekList.data?.bookings ?? []).filter((b) => b.startDate <= d && b.endDate >= d);
              return (
                <div key={d} className={`bk-week-col${d === date ? ' on' : ''}`}>
                  <button type="button" className="bk-week-head" onClick={() => setDate(d)} aria-pressed={d === date}>
                    <b>{formatBookingDate(d)}</b>
                    {c ? <SizeUsage used={c.used} caps={c.caps} closed={c.closed} /> : <SkeletonText size={12} w="70%" />}
                  </button>
                  <ul className="bk-week-list">
                    {items.map((b) => (
                      <li key={b.id}>
                        <button type="button" className="bk-chip" onClick={() => setOpenId(b.id)}>
                          <b>{b.dogs.map((x) => x.name).join('・')}</b>
                          <span>
                            {b.status === 'pending' ? '確認待ち・' : ''}
                            {b.service === 'boarding' && b.endDate === d ? 'チェックアウト' : b.service === 'boarding' && b.startDate === d ? 'チェックイン' : b.service === 'boarding' ? 'お泊まり中' : `${b.startTime.replace(/^0/, '')}〜${b.endTime.replace(/^0/, '')}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {date && <DayPanel key={`${date}-${service}-${tick}`} date={date} service={service} onOpen={setOpenId} onChanged={changed} />}
      {openId !== null && <BookingDialog id={openId} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  );
}

/** その日の予約の一覧と、受け入れ数の変更(管理者) */
function DayPanel({ date, service, onOpen, onChanged }: { date: string; service: BookingService; onOpen: (id: number) => void; onChanged: () => void }) {
  const day = useLoad(() => adminApi<BookingDayResponse>(`/bookings/day?date=${date}&service=${service}`), [date, service]);
  const { staff, readOnly } = useAuth();
  const isAdmin = staff?.role === 'admin' && !readOnly;
  const d = day.data;
  return (
    <section className="panel bk-daypanel" aria-label={`${formatBookingDate(date)}の${BOOKING_SERVICE_LABELS[service]}`}>
      <div className="bk-daypanel-head">
        <h2>
          {formatBookingDate(date)}の{BOOKING_SERVICE_LABELS[service]}
        </h2>
        {d && <SizeUsage used={d.counts.used} caps={d.counts.caps} closed={d.counts.closed} />}
        {d?.counts.closed && <span className="sub-text">{d.counts.closedReason}</span>}
      </div>
      {day.error ? <ErrorNotice error={day.error} onRetry={() => void day.reload()} /> : null}
      <div className="bk-daypanel-sched">
        <BookingSchedule date={date} title="この日の預け・お迎え(預かり・お泊まり)" onChanged={onChanged} />
      </div>
      <h3 className="bk-daypanel-sub">この日の{BOOKING_SERVICE_LABELS[service]}の予約</h3>
      {!d ? (
        <Loading>
          <div className="bk-daypanel-body">
            <SkeletonText size={15} lines={3} />
          </div>
        </Loading>
      ) : d.bookings.length === 0 ? (
        <p className="empty">この日の予約はありません。</p>
      ) : (
        <ul className="bk-adm-list">
          {d.bookings.map((b) => (
            <li key={b.id}>
              <BookingRowButton b={b} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
      {d && isAdmin && <OverrideForm key={JSON.stringify(d.override)} date={date} service={service} day={d} onSaved={() => { void day.reload(); onChanged(); }} />}
      {d && !isAdmin && d.override && (
        <p className="sub-text bk-daypanel-foot">この日は受け入れる頭数を変えています{d.override.note ? `(${d.override.note})` : ''}。変えるのは管理者です。</p>
      )}
    </section>
  );
}

/** その日の受け入れ数を変える・休みにする・いつもの数に戻す(A-22。管理者) */
function OverrideForm({ date, service, day, onSaved }: { date: string; service: BookingService; day: BookingDayResponse; onSaved: () => void }) {
  const o = day.override;
  const [closed, setClosed] = useState(o?.closed ?? false);
  const [caps, setCaps] = useState<Record<'small' | 'medium' | 'large', string>>({
    small: o?.caps.small?.toString() ?? '',
    medium: o?.caps.medium?.toString() ?? '',
    large: o?.caps.large?.toString() ?? '',
  });
  const [note, setNote] = useState(o?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const id = useId();
  const save = async (reset: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const toNum = (v: string) => (v.trim() === '' ? null : Number(v));
      const r = await adminApi<{ auditId: number | null }>('/bookings/overrides', {
        method: 'PUT',
        body: JSON.stringify(
          reset ? { date, service, reset: true } : { date, service, closed, caps: { small: toNum(caps.small), medium: toNum(caps.medium), large: toNum(caps.large) }, note: note || null },
        ),
      });
      toast({ message: reset ? 'いつもの数に戻しました。' : 'この日の受け入れる頭数を変えました。', undo: { auditId: r.auditId, onUndone: onSaved } });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="bk-override" open={!!o}>
      <summary>この日の受け入れる頭数を変える{o ? '(変えています)' : ''}</summary>
      <div className="bk-override-body">
        <label className="check">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          この日は{BOOKING_SERVICE_LABELS[service]}を休みにする
        </label>
        {!closed && (
          <div className="cfg-row">
            {(['small', 'medium', 'large'] as const).map((s) => (
              <div key={s} className="field">
                <label htmlFor={`${id}-${s}`}>{DOG_SIZE_LABELS[s]}</label>
                <div className="cfg-num">
                  <input
                    id={`${id}-${s}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    placeholder={String(day.counts.caps[s])}
                    value={caps[s]}
                    onChange={(e) => setCaps((c) => ({ ...c, [s]: e.target.value }))}
                  />
                  <span className="sub-text">頭</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <span className="hint">空欄のサイズは、いつもの数のままです。</span>
        <div className="field">
          <label htmlFor={`${id}-note`}>メモ(お客さんには出ません)</label>
          <input id={`${id}-note`} maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 研修のため" />
        </div>
        {error ? <ErrorNotice error={error} /> : null}
        <div className="bk-override-acts">
          {o && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void save(true)}>
              いつもの数に戻す
            </button>
          )}
          <button type="button" className="btn sub" disabled={busy} onClick={() => void save(false)}>
            <BusyLabel busy={busy} pending="保存しています…">
              この日の数を保存する
            </BusyLabel>
          </button>
        </div>
      </div>
    </details>
  );
}
