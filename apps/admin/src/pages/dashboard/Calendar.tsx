import { addDays, addMonthsToDate, type CalendarDay, type DashboardDayResponse, type DashboardDaysResponse } from '@dr/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { DayNotes } from '../../components/DayNotes';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { Skeleton, SkeletonText } from '../../components/Skeleton';
import { WeatherIcon } from '../../components/WeatherIcon';
import { useLoad } from '../../hooks/useLoad';
import { adminApi } from '../../lib/api';
import { monthLabel, mdw, num, WEEKDAYS } from './format';
import { Panel, type PanelCsv } from './parts';

// 日ごとのカレンダー(docs/design.md 12.3)。マスに天気のアイコン・最高気温・来場組数と、イベント・メモ・臨時休業の印。
// マスの濃さは来場組数(1系列目の色の薄い塗り、5段階)。マスを押すと、右からその日の詳細が出る。

const DAY_TYPE_LABEL = { weekday: '平日', saturday: '土曜', sunday: '日曜', holiday: '祝日' } as const;

function levelOf(groups: number, max: number) {
  if (groups <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((groups / max) * 5)));
}

export function CalendarPanel({ initialMonth, today, onNotesChanged }: { initialMonth: string; today: string; onNotesChanged: () => void }) {
  const [month, setMonth] = useState(initialMonth);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => adminApi<DashboardDaysResponse>(`/dashboard/days?month=${month}`), [month]);
  useEffect(() => setMonth(initialMonth), [initialMonth]);
  const shift = (k: number) => setMonth(addMonthsToDate(`${month}-01`, k).slice(0, 7));
  const first = `${month}-01`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const days = data?.month === month ? data.days : null;

  return (
    <Panel
      title="日ごとのカレンダー"
      note="マスの濃さは来場組数です。マスを押すと、その日の天気・内訳・時間帯・メモが出ます。"
      wide
      actions={
        <div className="dsb-cal-nav">
          <button type="button" className="btn ghost icon-btn" aria-label="前の月" onClick={() => shift(-1)}>
            <Icon name="chevron-left" />
          </button>
          <span className="dsb-cal-month" aria-live="polite">
            {monthLabel(month, true)}
          </span>
          <button type="button" className="btn ghost icon-btn" aria-label="次の月" onClick={() => shift(1)}>
            <Icon name="chevron-right" />
          </button>
        </div>
      }
      csv={
        days
          ? (): PanelCsv => ({
              unit: '1日1行',
              columns: [
                { name: '日付', desc: '日本時間' },
                { name: '曜日区分', desc: '平日 / 土曜 / 日曜 / 祝日' },
                { name: '祝日名', desc: '祝日・休日の名前' },
                { name: '臨時休業', desc: '臨時休業日なら「休業」' },
                { name: '天気', desc: '晴れ / 曇り / 雨' },
                { name: '最高気温(℃)', desc: 'アメダスの観測値' },
                { name: '最低気温(℃)', desc: 'アメダスの観測値' },
                { name: '降水量(mm)', desc: '1日の合計' },
                { name: '来場組数(組)', desc: 'チェックインの件数(会員以外の入力を含む)' },
                { name: '会員の来場組数(組)', desc: '会員のおうちの来場' },
                { name: '来場頭数(頭)', desc: 'ワンちゃんの数' },
                { name: 'イベント', desc: 'その日のイベント' },
                { name: 'メモの数(件)', desc: 'その日のメモの件数' },
              ],
              rows: days.map((d) => [
                d.date, DAY_TYPE_LABEL[d.dayType], d.holidayName, d.closed ? '休業' : '', d.weather, d.tempMax, d.tempMin, d.precipitation,
                d.future ? '' : d.groups, d.future ? '' : d.memberGroups, d.future ? '' : d.dogs, d.events.join(' / '), d.noteCount,
              ]),
            })
          : undefined
      }
    >
      {error ? <ErrorNotice error={error} onRetry={() => void reload()} /> : null}
      <div className="dsb-cal" role="group" aria-label={`${monthLabel(month, true)}のカレンダー`} aria-busy={!days}>
        <div className="dsb-cal-row dsb-cal-head" aria-hidden="true">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={i === 0 || i === 6 ? 'we' : undefined}>
              {w}
            </span>
          ))}
        </div>
        <div className="dsb-cal-body">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} className="dsb-cal-blank" aria-hidden="true" />
          ))}
          {days
            ? days.map((d) => <DayCell key={d.date} d={d} max={data!.maxGroups} today={today} onOpen={() => setOpenDate(d.date)} />)
            : Array.from({ length: Number(addDays(addMonthsToDate(first, 1), -1).slice(8)) }, (_, i) => (
                <span key={i} className="dsb-cal-cell sk-cell" aria-hidden="true">
                  <Skeleton w={18} h={12} r={4} />
                  <Skeleton w="60%" h={10} r={4} />
                </span>
              ))}
        </div>
      </div>
      <ul className="dsb-legend dsb-cal-legend" aria-label="カレンダーの見方">
        <li>
          <span className="dsb-heat" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((l) => (
              <span key={l} className={`lv${l}`} />
            ))}
          </span>
          来場組数(少ない → 多い)
        </li>
        <li>
          <span className="dsb-flag ev" aria-hidden="true" />
          イベント
        </li>
        <li>
          <span className="dsb-flag note" aria-hidden="true" />
          メモ
        </li>
        <li>
          <span className="dsb-closed-tag">休</span>
          臨時休業
        </li>
      </ul>
      {openDate && (
        <DayDrawer
          date={openDate}
          onClose={() => setOpenDate(null)}
          onChanged={() => {
            void reload();
            onNotesChanged();
          }}
        />
      )}
    </Panel>
  );
}

function DayCell({ d, max, today, onOpen }: { d: CalendarDay; max: number; today: string; onOpen: () => void }) {
  const lv = d.closed || d.future ? 0 : levelOf(d.groups, max);
  const day = Number(d.date.slice(8));
  const label = [
    mdw(d.date),
    d.holidayName,
    d.closed ? `臨時休業${d.closedNote ? `(${d.closedNote})` : ''}` : null,
    d.weather ? `${d.weather}${d.tempMax !== null ? ` 最高${d.tempMax}℃` : ''}` : null,
    d.future ? null : `来場${d.groups}組`,
    d.events.length ? `イベント ${d.events.join('・')}` : null,
    d.noteCount ? `メモ${d.noteCount}件` : null,
  ]
    .filter(Boolean)
    .join('、');
  return (
    <button
      type="button"
      className={`dsb-cal-cell lv${lv}${d.date === today ? ' today' : ''}${d.future ? ' future' : ''}${d.dayType !== 'weekday' ? ' we' : ''}`}
      aria-label={label}
      onClick={onOpen}
    >
      <span className="dsb-cal-top">
        <span className="dsb-cal-day">{day}</span>
        <span className="dsb-cal-flags" aria-hidden="true">
          {d.events.length > 0 && <span className="dsb-flag ev" />}
          {d.noteCount > 0 && <span className="dsb-flag note" />}
        </span>
      </span>
      {d.closed ? (
        <span className="dsb-closed-tag" aria-hidden="true">
          休
        </span>
      ) : (
        <span className="dsb-cal-wx" aria-hidden="true">
          <WeatherIcon kind={d.weather} size={15} />
          {d.tempMax !== null && <span>{Math.round(d.tempMax)}°</span>}
        </span>
      )}
      <span className="dsb-cal-n" aria-hidden="true">
        {d.future || d.closed ? '' : `${d.groups}組`}
      </span>
    </button>
  );
}

/** 日の詳細(右から出るパネル)。Esc・背景・「閉じる」で閉じる。開いたら「閉じる」にフォーカス、閉じたら元のマスに戻す */
export function DayDrawer({ date, onClose, onChanged }: { date: string; onClose: () => void; onChanged: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { data, error, reload } = useLoad(() => adminApi<DashboardDayResponse>(`/dashboard/day/${date}`), [date]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className="dsb-drawer-wrap">
      <div className="dsb-drawer-back" onClick={onClose} aria-hidden="true" />
      <aside className="dsb-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dsb-drawer-head">
          <h2 id={titleId}>{mdw(date)}の様子</h2>
          <button ref={closeRef} type="button" className="btn ghost icon-btn" aria-label="閉じる" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dsb-drawer-body">
          {error ? <ErrorNotice error={error} onRetry={() => void reload()} /> : null}
          {!data ? (
            !error && (
              <div aria-busy="true">
                <span className="sr-only">読み込んでいます</span>
                <SkeletonText size={15} w="60%" />
                <Skeleton h={120} r={8} style={{ marginTop: 16 }} />
              </div>
            )
          ) : (
            <DayDetail d={data} onChanged={onChanged} />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function DayDetail({ d, onChanged }: { d: DashboardDayResponse; onChanged: () => void }) {
  const t = d.totals;
  const busy = d.hourly.filter((h) => h.groups > 0);
  const firstH = Math.min(8, ...busy.map((h) => h.hour));
  const lastH = Math.max(20, ...busy.map((h) => h.hour));
  const hours = d.hourly.filter((h) => h.hour >= firstH && h.hour <= lastH);
  const maxH = Math.max(1, ...hours.map((h) => h.groups));
  const future = d.date > d.today;
  return (
    <>
      <section className="dsb-dd-sec" aria-label="天気">
        <p className="dsb-dd-sub">
          {DAY_TYPE_LABEL[d.dayType]}
          {d.holidayName ? `・${d.holidayName}` : ''}
        </p>
        {d.closed && (
          <div className="alert warning">
            <p>臨時休業日です{d.closedNote ? `(${d.closedNote})` : ''}。この日の来場は数えていません。</p>
          </div>
        )}
        {d.weather ? (
          <p className="dsb-dd-wx">
            <WeatherIcon kind={d.weather.kind} size={22} />
            <span>
              <b>{d.weather.kind ?? '天気の区分なし'}</b>
              <span className="dsb-dd-wx-sub">
                最高 {d.weather.tempMax ?? '—'}℃ / 最低 {d.weather.tempMin ?? '—'}℃ · 降水量 {d.weather.precipitation ?? '—'}mm
                {d.weather.station ? ` · ${d.weather.station}` : ''}
              </span>
            </span>
          </p>
        ) : (
          <p className="dsb-dd-wx-sub">{future ? 'まだ先の日です。' : 'この日の天気の記録はありません。'}</p>
        )}
      </section>

      {!future && (
        <section className="dsb-dd-sec" aria-label="この日の来場">
          <div className="dsb-dd-nums">
            <Num label="来場組数" v={t.groups} u="組" />
            <Num label="会員の来場" v={t.memberGroups} u="組" />
            <Num label="来場頭数" v={t.dogs} u="頭" />
            <Num label="会員以外" v={t.dogsWalkin} u="頭" />
            <Num label="新しいおうち" v={t.newHouseholds} u="軒" />
            <Num label="無料券の使用" v={t.ticketsUsed} u="枚" />
          </div>
          <h3 className="dsb-dd-h">時間帯ごとの来場</h3>
          {busy.length === 0 ? (
            <p className="dsb-dd-wx-sub">この日の来場はありません。</p>
          ) : (
            <div
              className="dsb-hours"
              role="img"
              aria-label={`時間帯ごとの来場。${busy.map((h) => `${h.hour}時 ${h.groups}組`).join('、')}`}
            >
              {hours.map((h) => (
                <span key={h.hour} className="dsb-hour">
                  <span className="dsb-hour-bar" style={{ height: `${(h.groups / maxH) * 100}%` }} title={`${h.hour}時 ${h.groups}組`} />
                  <span className="dsb-hour-l">{h.hour % 2 === 0 ? h.hour : ''}</span>
                </span>
              ))}
            </div>
          )}
          <Link className="dsb-dd-link" to={`/?date=${d.date}`}>
            この日の来場の一覧を見る
            <Icon name="chevron-right" size={16} />
          </Link>
        </section>
      )}

      {d.events.length > 0 && (
        <section className="dsb-dd-sec" aria-label="イベント">
          <h3 className="dsb-dd-h">イベント</h3>
          <ul className="dsb-dd-events">
            {d.events.map((e, i) => (
              <li key={i}>
                <b>{e.name}</b>
                {e.kind || e.memo ? <span className="dsb-dd-wx-sub">{[e.kind, e.memo].filter(Boolean).join(' · ')}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dsb-dd-sec" aria-label="この日のメモ">
        <h3 className="dsb-dd-h">この日のメモ</h3>
        <DayNotes date={d.date} onChanged={onChanged} />
      </section>
    </>
  );
}

function Num({ label, v, u }: { label: string; v: number; u: string }) {
  return (
    <div className="dsb-dd-num">
      <span className="l">{label}</span>
      <span className="v">
        {num(v)}
        <small>{u}</small>
      </span>
    </div>
  );
}
