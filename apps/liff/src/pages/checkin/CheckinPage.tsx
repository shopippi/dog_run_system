import type { CheckinResult, CheckinStatus } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { ApiError, api, postJson } from '../../lib/api';
import { canScan, scanCheckinCode } from '../../lib/liff';

/** L-05 チェックイン(C-04)。受付のQRコードから開く → 来た犬を選ぶ → 無料券を使うか選ぶ → 確定 */
export function CheckinPage() {
  const [params, setParams] = useSearchParams();
  const passphrase = params.get('k');
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [useTicket, setUseTicket] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api<CheckinStatus>('/api/checkins/today');
      setStatus(s);
      // はじめは全員を選んでおく(すでに記録された犬は除く)
      const done = new Set(s.visit?.dogIds ?? []);
      setSelected(new Set(s.dogs.filter((d) => !done.has(d.id)).map((d) => d.id)));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<CheckinResult>('/api/checkins', {
        passphrase,
        dogIds: [...selected],
        useTicket,
      });
      navigate(`/checkin/done/${res.visitId}`, { replace: true });
    } catch (e) {
      // 家族が先にチェックインしていた場合は、追加の画面に切り替える
      if (e instanceof ApiError && e.code === 'already_checked_in') await load();
      setError(e);
      setBusy(false);
    }
  };

  const addDogs = async () => {
    if (!status?.visit) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/checkins/${status.visit.id}/dogs`, { dogIds: [...selected] });
      navigate(`/checkin/done/${status.visit.id}`, { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const scan = async () => {
    const k = await scanCheckinCode().catch(() => null);
    if (k) setParams({ k }, { replace: true });
  };

  if (!status) {
    return (
      <main className="screen">
        {error ? <ErrorNotice error={error} onRetry={load} /> : <p className="loading">読み込んでいます…</p>}
      </main>
    );
  }

  const visit = status.visit;
  const remaining = status.dogs.filter((d) => !visit?.dogIds.includes(d.id));

  if (visit) {
    // 5.5 家族がすでにチェックインしている日。犬の追加だけができる(ポイントは増えない)
    return (
      <main className="screen">
        <div className="page-head">
          <h2>チェックイン</h2>
        </div>
        <div className="alert info">
          <p>
            <b>{visit.isMe ? '今日はチェックイン済みです。' : `今日は${visit.checkedInBy || 'ご家族'}さんがチェックイン済みです。`}</b>
          </p>
          <p>ポイントは1日1回です。一緒に来たワンちゃんを追加できます。</p>
        </div>
        {remaining.length > 0 ? (
          <>
            <DogChecklist dogs={remaining} selected={selected} onToggle={toggle} />
            {error ? <ErrorNotice error={error} /> : null}
            <button type="button" className="btn" disabled={busy || selected.size === 0} onClick={addDogs}>
              {busy ? '追加しています…' : 'ワンちゃんを追加する'}
            </button>
          </>
        ) : (
          <p className="lead">登録しているワンちゃんは、みんな記録されています。</p>
        )}
        <button
          type="button"
          className={remaining.length > 0 ? 'btn ghost' : 'btn'}
          onClick={() => navigate(`/checkin/done/${visit.id}`)}
        >
          チェックインの画面を見る
        </button>
      </main>
    );
  }

  if (!passphrase) {
    return (
      <main className="screen">
        <div className="page-head">
          <h2>チェックイン</h2>
          <p className="lead">受付にあるQRコードを、LINEのカメラで読み取ってください。</p>
        </div>
        {canScan() && (
          <button type="button" className="btn" onClick={scan}>
            QRコードを読み取る
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="page-head">
        <h2>チェックイン</h2>
        <p className="lead">今日来たワンちゃんを選んで、「チェックインする」を押してください。</p>
      </div>
      <DogChecklist dogs={status.dogs} selected={selected} onToggle={toggle} />
      {status.unusedTickets > 0 && (
        <label className="pick-row ticket-row">
          <input type="checkbox" checked={useTicket} onChange={(e) => setUseTicket(e.target.checked)} />
          <span className="pick-body">
            <b>無料券を使う</b>
            <span className="sub-text">のこり{status.unusedTickets}枚。1回の来場で1枚まで使えます</span>
          </span>
        </label>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn" disabled={busy || selected.size === 0} onClick={submit}>
        {busy ? 'チェックインしています…' : 'チェックインする'}
      </button>
    </main>
  );
}

function DogChecklist({
  dogs,
  selected,
  onToggle,
}: {
  dogs: CheckinStatus['dogs'];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="pick-list" role="group" aria-label="今日来たワンちゃん">
      {dogs.map((d) => (
        <label key={d.id} className="pick-row">
          <input type="checkbox" checked={selected.has(d.id)} onChange={() => onToggle(d.id)} />
          <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
          <span className="pick-body">
            <b>{d.name}</b>
            <span className="sub-text">{d.breedName}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
