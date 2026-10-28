import { toJstIso, type CheckinResult, type HouseholdHit, type ProxyStatus } from '@dr/shared';
import { useEffect, useState } from 'react';
import { adminApi, adminPost } from '../lib/api';
import { DogFace } from './DogFace';
import { ErrorNotice } from './ErrorNotice';

const today = () => toJstIso(new Date()).slice(0, 10);

/** 代理チェックイン(S-04)。来た犬・日付・無料券を選んで、受付が代わりにチェックインする */
export function ProxyCheckin({ h }: { h: HouseholdHit }) {
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(h.dogs.map((d) => d.id)));
  const [useTicket, setUseTicket] = useState(false);
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<CheckinResult | null>(null);

  useEffect(() => {
    let alive = true;
    setStatus(null);
    setError(null);
    adminApi<ProxyStatus>(`/checkins/proxy/status?householdId=${h.id}&date=${date}`)
      .then((s) => alive && setStatus(s))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [h.id, date, done]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(
        await adminPost<CheckinResult>('/checkins/proxy', {
          householdId: h.id,
          dogIds: [...selected],
          useTicket: useTicket && (status?.unusedTickets ?? 0) > 0,
          date,
        }),
      );
      setUseTicket(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="proxy" role="group" aria-label="代理チェックイン">
      <div className="field date-field">
        <label htmlFor={`proxy-date-${h.id}`}>来場日</label>
        <input
          id={`proxy-date-${h.id}`}
          type="date"
          value={date}
          max={today()}
          onChange={(e) => {
            setDate(e.target.value || today());
            setDone(null);
          }}
        />
        <span className="hint">紙に書いた分は、その日を選んでください</span>
      </div>
      <div className="field">
        <span className="label" id={`proxy-dogs-${h.id}`}>
          来たワンちゃん
        </span>
        <div className="pick-list" role="group" aria-label="来たワンちゃん">
          {h.dogs.map((d) => (
            <label key={d.id} className="pick-row">
              <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              <DogFace name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
              <span className="pick-body">
                <b>{d.name}</b>
                <span className="sub-text">{d.breedName}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {status && status.unusedTickets > 0 && !status.visitId && (
        <label className="check">
          <input type="checkbox" checked={useTicket} onChange={(e) => setUseTicket(e.target.checked)} />
          無料券を使う(のこり{status.unusedTickets}枚)
        </label>
      )}
      {done ? (
        <div className="alert info" role="status">
          チェックインしました。
          {done.pointsAwarded > 0 ? `${done.pointsAwarded}ポイントを付けました。` : ''}
          {done.usedTicket ? '無料券を使いました。料金を調整してください。' : ''}
          {done.ticketsIssued > 0 ? `ポイントがたまり、無料券が${done.ticketsIssued}枚発行されました。` : ''}
        </div>
      ) : status?.visitId ? (
        <div className="alert info">この日は、すでにチェックイン済みです(ポイントは1日1回)。</div>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      {!done && !status?.visitId && (
        <div className="proxy-actions">
          <button type="button" className="btn" disabled={busy || selected.size === 0 || !status} onClick={submit}>
            {busy ? 'チェックインしています…' : '代理でチェックインする'}
          </button>
        </div>
      )}
    </div>
  );
}
