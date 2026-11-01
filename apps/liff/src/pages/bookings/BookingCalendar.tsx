import { DAY_AVAILABILITY_LABELS, addDays, type BookingAvailabilityResponse, type BookingService, type DayAvailability } from '@dr/shared';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** マスの中の短い言葉(下の凡例に、正式な言葉を出す) */
const SHORT: Record<DayAvailability, string> = { open: '空き', few: 'わずか', full: '満員', closed: '休み', out: '' };

const pad = (n: number) => String(n).padStart(2, '0');
const monthStart = (ym: string) => `${ym}-01`;
function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * 空きのカレンダー(C-15)。選んだワンちゃんのサイズで、1日ずつ「空きあり・残りわずか・満員・休み」を出す。
 * 満員・休み・受付期間の外は押せない。
 * - 預かり: 1日を選ぶ
 * - お泊まり: チェックインの日 → チェックアウトの日の順に選ぶ。間の夜がすべて空いていて、チェックアウトの日が休みでないこと
 */
export function BookingCalendar({
  service,
  dogIds,
  first,
  last,
  maxNights,
  start,
  end,
  onChange,
}: {
  service: BookingService;
  dogIds: number[];
  first: string;
  last: string;
  maxNights: number;
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
}) {
  const [ym, setYm] = useState((start ?? first).slice(0, 7));
  const [days, setDays] = useState<Map<string, DayAvailability> | null>(null);
  const [error, setError] = useState(false);

  // 月を移っても、前の月の空きは覚えておく(月をまたぐお泊まりで、前の月の夜も確かめるため)
  const key = `${service}:${dogIds.join(',')}`;
  const [cacheKey, setCacheKey] = useState(key);
  const [loading, setLoading] = useState(true);
  if (cacheKey !== key) {
    setCacheKey(key);
    setDays(null);
  }
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    // 翌月の初めも読む(月末にチェックインして、翌月にチェックアウトするため)
    const to = addDays(monthEnd(ym), 7);
    api<BookingAvailabilityResponse>(
      `/api/bookings/availability?service=${service}&from=${monthStart(ym)}&to=${to}&dogIds=${dogIds.join(',')}`,
    )
      .then((r) => {
        if (!alive) return;
        setDays((prev) => {
          const next = new Map(prev ?? []);
          for (const d of r.days) next.set(d.date, d.status);
          return next;
        });
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ym, key]);

  const statusOf = (d: string): DayAvailability => (d < first || d > last ? 'out' : (days?.get(d) ?? 'out'));
  const nightOk = (d: string) => {
    const s = statusOf(d);
    return s === 'open' || s === 'few';
  };

  /** お泊まりで、start から d までをチェックアウトにできるか */
  const canCheckout = (d: string) => {
    if (!start || d <= start) return false;
    let n = 0;
    for (let x = start; x < d; x = addDays(x, 1)) {
      if (!nightOk(x)) return false;
      n += 1;
    }
    if (n > maxNights) return false;
    // チェックアウトの日はお店が開いている日(満員でもよい)
    const s = days?.get(d);
    return s !== undefined && s !== 'closed';
  };

  const choosingCheckout = service === 'boarding' && start !== null && end === null;

  const pick = (d: string) => {
    if (service === 'daycare') {
      onChange(d, d);
      return;
    }
    if (choosingCheckout && canCheckout(d)) {
      onChange(start, d);
      return;
    }
    onChange(d, null);
  };

  const enabled = (d: string) => {
    if (choosingCheckout) return canCheckout(d) || nightOk(d);
    return nightOk(d);
  };

  const firstDay = monthStart(ym);
  const lead = new Date(`${firstDay}T00:00:00Z`).getUTCDay();
  const cells: (string | null)[] = [...Array<null>(lead).fill(null)];
  for (let d = firstDay; d <= monthEnd(ym); d = addDays(d, 1)) cells.push(d);
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const canPrev = ym > first.slice(0, 7);
  const canNext = ym < last.slice(0, 7);

  const inRange = (d: string) => start !== null && end !== null && d > start && d < end;

  return (
    <div className="bk-cal" aria-busy={loading}>
      <div className="bk-cal-head">
        <button type="button" className="btn ghost bk-cal-nav" disabled={!canPrev} onClick={() => setYm(shiftMonth(ym, -1))} aria-label="前の月">
          <Icon name="chevron-left" />
        </button>
        <p className="bk-cal-month" aria-live="polite">
          {y}年{m}月
        </p>
        <button type="button" className="btn ghost bk-cal-nav" disabled={!canNext} onClick={() => setYm(shiftMonth(ym, 1))} aria-label="次の月">
          <Icon name="chevron-right" />
        </button>
      </div>
      {error ? (
        <p className="note" role="alert">
          空きを読み込めませんでした。電波のよい場所で、月を切り替えてもう一度お試しください。
        </p>
      ) : null}
      <div className="bk-cal-grid" role="grid" aria-label={`${y}年${m}月の空き`}>
        {WEEK.map((w) => (
          <span key={w} className="bk-cal-wd" role="columnheader">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} className="bk-cal-cell empty" aria-hidden="true" />;
          const s = statusOf(d);
          const on = d === start || d === end;
          const ok = !loading && days !== null && enabled(d);
          const label = `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日(${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]}) ${s === 'out' ? '選べません' : DAY_AVAILABILITY_LABELS[s]}${d === start ? (service === 'boarding' ? '・チェックイン' : '・選んでいます') : ''}${d === end && service === 'boarding' ? '・チェックアウト' : ''}`;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              className={`bk-cal-cell s-${s}${on ? ' on' : ''}${inRange(d) ? ' mid' : ''}`}
              disabled={!ok}
              aria-pressed={on}
              aria-label={label}
              data-date={d}
              data-status={s}
              onClick={() => pick(d)}
            >
              <b>{Number(d.slice(8))}</b>
              <span>{days?.has(d) ? SHORT[s] : ''}</span>
            </button>
          );
        })}
      </div>
      <p className="bk-cal-legend note">
        空き = {DAY_AVAILABILITY_LABELS.open}・わずか = {DAY_AVAILABILITY_LABELS.few}・満員と休みの日は選べません
      </p>
    </div>
  );
}
