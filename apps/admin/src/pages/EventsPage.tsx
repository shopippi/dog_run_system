import {
  EVENT_KINDS,
  toJstDate,
  type AdminClosuresResponse,
  type AdminEvent,
  type AdminEventsResponse,
} from '@dr/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { RadioSegment, formatYmd } from '../components/SettingsKit';
import { adminApi, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const KIND_OPTIONS = EVENT_KINDS.map((k) => ({ value: k, label: k }));
type Kind = (typeof EVENT_KINDS)[number];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function daysOf(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
const monthLabel = (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;

type MonthData = { events: AdminEvent[]; closures: AdminClosuresResponse['closures']; holidays: AdminClosuresResponse['holidays'] };

/**
 * M-10 イベント・休業日(A-09)。月ごとのカレンダーで、イベントと臨時休業日を見て、追加・削除する。
 * イベントの日と休業日は、ダッシュボードの分析に使う(臨時休業日は指標から除く)。
 */
export function EventsPage() {
  const today = toJstDate(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { readOnly } = useAuth();

  const load = useCallback(async (m: string) => {
    try {
      const [e, c] = await Promise.all([
        adminApi<AdminEventsResponse>(`/events?month=${m}`),
        adminApi<AdminClosuresResponse>(`/closures?month=${m}`),
      ]);
      setData({ events: e.events, closures: c.closures, holidays: c.holidays });
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    setData(null);
    void load(month);
  }, [month, load]);

  const go = (delta: number) => {
    const m = shiftMonth(month, delta);
    setMonth(m);
    setSelected(today.startsWith(m) ? today : `${m}-01`);
  };

  const days = daysOf(month);
  const lead = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const eventsOn = (d: string) => data?.events.filter((e) => e.date === d) ?? [];
  const closureOn = (d: string) => data?.closures.find((c) => c.date === d) ?? null;
  const holidayOn = (d: string) => data?.holidays.find((h) => h.date === d)?.name ?? null;

  return (
    <div className="page">
      <PageHead
        title="イベント・休業日"
        howto="カレンダーの日付を押すと、その日のイベントと臨時休業を登録できます。イベントの日はダッシュボードで来場の増え方を比べ、臨時休業日は来場の集計から除きます。"
      />
      {error ? <ErrorNotice error={error} onRetry={() => void load(month)} /> : null}
      <div className="cfg-cal-layout">
        <section className="panel cfg-cal" aria-label="カレンダー">
          <div className="cfg-cal-head">
            <button type="button" className="btn ghost" onClick={() => go(-1)}>
              <Icon name="chevron-left" />
              前の月
            </button>
            <h2 aria-live="polite">{monthLabel(month)}</h2>
            <button type="button" className="btn ghost" onClick={() => go(1)}>
              次の月
              <Icon name="chevron-right" />
            </button>
          </div>
          <div className="cfg-cal-grid" role="grid" aria-label={`${monthLabel(month)}のカレンダー`}>
            <div className="cfg-cal-row" role="row">
              {WEEK.map((w) => (
                <span key={w} className="cfg-cal-w" role="columnheader">
                  {w}
                </span>
              ))}
            </div>
            {Array.from({ length: Math.ceil((lead + days.length) / 7) }, (_, week) => (
              <div className="cfg-cal-row" role="row" key={week}>
                {Array.from({ length: 7 }, (_, wd) => {
                  const i = week * 7 + wd - lead;
                  const d = days[i];
                  if (!d) return <span key={wd} className="cfg-cal-cell cfg-cal-blank" role="gridcell" />;
                  const evs = eventsOn(d);
                  const closed = closureOn(d);
                  const holiday = holidayOn(d);
                  const label = [
                    formatYmd(d),
                    d === today ? '今日' : '',
                    holiday ?? '',
                    closed ? '臨時休業' : '',
                    evs.length ? `イベント${evs.length}件` : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <span key={wd} role="gridcell" className="cfg-cal-gc">
                      <button
                        type="button"
                        className={`cfg-cal-cell${d === today ? ' today' : ''}${closed ? ' closed' : ''}`}
                        aria-pressed={selected === d}
                        aria-label={label}
                        onClick={() => setSelected(d)}
                      >
                        <span className="cfg-cal-d">{Number(d.slice(8))}</span>
                        {holiday && <span className="cfg-cal-hol">{holiday}</span>}
                        {closed && <span className="badge">休業</span>}
                        {evs.slice(0, 2).map((e) => (
                          <span key={e.id} className="cfg-cal-ev">
                            {e.name}
                          </span>
                        ))}
                        {evs.length > 2 && <span className="cfg-cal-more">ほか{evs.length - 2}件</span>}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
        {data && selected.startsWith(month) && (
          <DayPanel
            key={selected}
            date={selected}
            holiday={holidayOn(selected)}
            closure={closureOn(selected)}
            events={eventsOn(selected)}
            readOnly={readOnly}
            onChanged={() => void load(month)}
          />
        )}
      </div>
    </div>
  );
}

function DayPanel({
  date,
  holiday,
  closure,
  events,
  readOnly,
  onChanged,
}: {
  date: string;
  holiday: string | null;
  closure: { date: string; note: string | null } | null;
  events: AdminEvent[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('イベント');
  const [memo, setMemo] = useState('');
  const [note, setNote] = useState('');
  const nameId = useId();
  const memoId = useId();
  const noteId = useId();
  const headId = useId();

  const run = async (fn: () => Promise<unknown>, message: string, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      setNotice(message);
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel cfg-day" aria-labelledby={headId}>
      <div className="cfg-day-head">
        <h2 id={headId}>{formatYmd(date, true)}</h2>
        {holiday && <span className="sub-text">{holiday}</span>}
      </div>
      <p className="sr-only" role="status">
        {notice}
      </p>
      {error ? <ErrorNotice error={error} /> : null}

      <div className="cfg-day-block">
        <h3>臨時休業</h3>
        {closure ? (
          <div className="cfg-day-row">
            <span>
              <span className="badge">休業</span> {closure.note ?? ''}
            </span>
            {!readOnly && (
              <button
                type="button"
                className="btn ghost cfg-danger-text"
                disabled={busy}
                onClick={() => void run(() => adminApiDelete(`/closures/${date}`), '臨時休業をやめました。')}
              >
                休業をやめる
              </button>
            )}
          </div>
        ) : readOnly ? (
          <p className="sub-text">この日は営業日です。</p>
        ) : (
          <form
            className="cfg-day-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => adminPost('/closures', { date, note }), '臨時休業日にしました。', () => setNote(''));
            }}
          >
            <div className="field">
              <label htmlFor={noteId}>休業の理由(なくてもよい)</label>
              <input id={noteId} value={note} maxLength={100} placeholder="例: 芝の張り替え" onChange={(e) => setNote(e.target.value)} />
            </div>
            <button type="submit" className="btn sub" disabled={busy}>
              臨時休業にする
            </button>
          </form>
        )}
      </div>

      <div className="cfg-day-block">
        <h3>イベント</h3>
        {events.length === 0 ? (
          <p className="sub-text">この日のイベントはありません。</p>
        ) : (
          <ul className="cfg-day-events" aria-label="この日のイベント">
            {events.map((e) => (
              <li key={e.id} aria-label={e.name}>
                <span className="cfg-item-body">
                  <b>{e.name}</b>
                  <span className="sub-text">
                    {e.kind ?? 'イベント'}
                    {e.memo ? ` · ${e.memo}` : ''}
                  </span>
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn ghost cfg-danger-text"
                    aria-label={`${e.name}を消す`}
                    disabled={busy}
                    onClick={() => void run(() => adminApiDelete(`/events/${e.id}`), `「${e.name}」を消しました。`)}
                  >
                    消す
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form
            className="cfg-fieldset"
            aria-label="イベントを追加"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => adminPost('/events', { date, name, kind, memo }), `「${name.trim()}」を追加しました。`, () => {
                setName('');
                setMemo('');
              });
            }}
          >
            <div className="field">
              <label htmlFor={nameId}>イベントの名前</label>
              <input id={nameId} value={name} maxLength={50} placeholder="例: ハロウィン撮影会" onChange={(e) => setName(e.target.value)} />
            </div>
            <RadioSegment label="種類" options={KIND_OPTIONS} value={kind} onChange={setKind} />
            <div className="field">
              <label htmlFor={memoId}>メモ</label>
              <input id={memoId} value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
            </div>
            <div className="cfg-acts">
              <button type="submit" className="btn" disabled={busy || !name.trim()}>
                イベントを追加
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

const adminApiDelete = (path: string) => adminApi(path, { method: 'DELETE' });
