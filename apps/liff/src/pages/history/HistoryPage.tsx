import type { HistoryVisit, TicketHistoryResponse, VisitHistoryResponse } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { api } from '../../lib/api';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function monthOf(ymd: string) {
  const [y, m] = ymd.split('-').map(Number);
  return `${y}年${m}月`;
}

function dayOf(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return { day: d, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]! };
}

function whoOf(v: HistoryVisit) {
  if (v.method === 'proxy') return '受付で記録';
  if (v.checkedInByMe) return 'あなた';
  return v.checkedInBy ? `${v.checkedInBy}さん` : '家族';
}

/** L-08 来場履歴(C-07)。新しい順に、月ごとの見出しをつけて並べる */
export function HistoryPage() {
  const [visits, setVisits] = useState<HistoryVisit[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<TicketHistoryResponse['events']>([]);

  const load = useCallback(() => {
    setError(null);
    api<VisitHistoryResponse>('/api/me/visits')
      .then((r) => {
        setVisits(r.visits);
        setNext(r.next);
      })
      .catch(setError);
    // 無料券の交換と使用(8章)。読めなくても来場の記録は出す
    api<TicketHistoryResponse>('/api/tickets/history')
      .then((r) => setTickets(r.events))
      .catch(() => setTickets([]));
  }, []);
  useEffect(load, [load]);

  const more = async () => {
    if (!next) return;
    setBusy(true);
    setMoreError(null);
    try {
      const r = await api<VisitHistoryResponse>(`/api/me/visits?before=${encodeURIComponent(next)}`);
      setVisits((v) => [...(v ?? []), ...r.visits]);
      setNext(r.next);
    } catch (e) {
      setMoreError(e);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={load} /></main>;
  if (!visits) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;

  const months: { label: string; visits: HistoryVisit[] }[] = [];
  for (const v of visits) {
    const label = monthOf(v.date);
    const last = months.at(-1);
    if (last?.label === label) last.visits.push(v);
    else months.push({ label, visits: [v] });
  }

  return (
    <main className="screen">
      <div className="page-head">
        <h2>来場履歴</h2>
        <p className="lead">おうちの来場と無料券の記録です。家族の誰がチェックインしても、ここにまとまります。</p>
      </div>

      {tickets.length > 0 && <TicketEvents events={tickets} />}

      {visits.length === 0 && <p className="cu-empty">まだ来場の記録がありません。</p>}

      {months.map((m) => (
        <section key={m.label} className="section" aria-label={m.label}>
          <h3 className="section-label">{m.label}</h3>
          <ul className="rows hist-list">
            {m.visits.map((v) => {
              const { day, weekday } = dayOf(v.date);
              return (
                <li key={v.id} className={v.cancelled ? 'hist-row cancelled' : 'hist-row'}>
                  <span className="hist-date" aria-label={`${day}日(${weekday})`}>
                    <b>{day}</b>
                    <span>{weekday}</span>
                  </span>
                  <span className="stack hist-dogs">
                    {v.dogs.slice(0, 3).map((d) => (
                      <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={36} />
                    ))}
                  </span>
                  <span className="hist-body">
                    <b>
                      {v.dogs.length === 0
                        ? 'ワンちゃん'
                        : v.dogs.map((d, i) => (
                            <span key={d.id} className="cu-nowrap">
                              {i > 0 && '・'}
                              {d.name}
                            </span>
                          ))}
                    </b>
                    <span className="sub-text">
                      <span className="cu-nowrap">{v.time}</span>
                      <span className="cu-nowrap">・{whoOf(v)}</span>
                      {!v.cancelled && <span className="cu-nowrap hist-points">・+{v.pointsAwarded}ポイント</span>}
                    </span>
                    {(v.cancelled || v.usedTicket || v.ticketsIssued > 0) && (
                      <span className="hist-badges">
                        {v.cancelled && <span className="badge">取り消し</span>}
                        {!v.cancelled && v.usedTicket && <span className="badge warning">無料券を使用</span>}
                        {!v.cancelled && v.ticketsIssued > 0 && <span className="badge">無料券をもらった</span>}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {moreError ? <ErrorNotice error={moreError} /> : null}
      {next && (
        <button type="button" className="btn sub" disabled={busy} onClick={more}>
          {busy ? '読み込んでいます…' : 'もっと前の来場を見る'}
        </button>
      )}
    </main>
  );
}

/** 無料券の記録(交換と使用。新しい順) */
function TicketEvents({ events }: { events: TicketHistoryResponse['events'] }) {
  return (
    <section className="section" aria-labelledby="hist-tickets">
      <h3 className="section-label" id="hist-tickets">
        無料券の記録
      </h3>
      <ul className="rows hist-list">
        {events.map((e) => {
          const date = e.at.slice(0, 10);
          const { day, weekday } = dayOf(date);
          const [, m] = date.split('-').map(Number);
          return (
            <li key={`${e.kind}-${e.ticketId}`} className="tk-hist-row">
              <span className="hist-date" aria-label={`${m}月${day}日(${weekday})`}>
                <b>{day}</b>
                <span>{m}月</span>
              </span>
              <span className="hist-body">
                <b>{e.kind === 'exchange' ? '無料券と交換' : '無料券を使用'}</b>
                <span className="sub-text">
                  <span className="cu-nowrap">{e.at.slice(11, 16)}</span>
                  {e.kind === 'exchange' && <span className="cu-nowrap hist-points">・−{e.points}ポイント</span>}
                </span>
              </span>
              {e.kind === 'use' && <span className="badge warning">使用しました</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
