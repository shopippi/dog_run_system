import { toJstIso, type CheckinDetail } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useClock } from '../../hooks/useClock';
import { api } from '../../lib/api';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日(${WEEKDAYS[w]})`;
}

/**
 * L-06 チェックイン完了(C-05)。受付で見せてもらう画面。
 * 現在時刻(秒まで)と流れ続ける細いバーで、スクリーンショットと見分けられるようにする(2章)。
 */
export function CheckinDonePage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<CheckinDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const now = useClock();

  const load = useCallback(() => {
    setError(null);
    api<CheckinDetail>(`/api/checkins/${id}`).then(setDetail).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={load} /></main>;
  if (!detail) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;

  const live = detail.isToday && !detail.cancelled;
  const clock = toJstIso(now).slice(11, 19);

  return (
    <main className="screen done-screen">
      {live ? (
        <section className="done live" aria-label="チェックイン完了">
          <div className="done-head">
            <p className="done-status">
              <span className="pulse" aria-hidden="true" />
              チェックイン完了
            </p>
            <p className="done-date">{formatDate(detail.visitDate)}</p>
            <p className="clock" role="timer" aria-label="現在時刻">
              {clock}
            </p>
          </div>
          <div className="done-body">
            {detail.usedTicket && <p className="used-ticket">無料券を使用</p>}
            <div className="stack">
              {detail.dogs.map((d) => (
                <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={72} />
              ))}
            </div>
            <p className="done-names">{detail.dogs.map((d) => d.name).join('・')}</p>
            <p className="done-meta">
              <span>{detail.dogs.length}頭</span>
              <span aria-hidden="true"> · </span>
              <span className="mono">{detail.memberNo}</span>
              <span aria-hidden="true"> · </span>
              {detail.pointsAwarded > 0 ? <span>+{detail.pointsAwarded}ポイント</span> : <span>ポイントは1日1回</span>}
            </p>
            <p className="note">
              チェックイン <span className="mono">{detail.checkedInAt.slice(11, 16)}</span>・受付でこの画面を見せてください
            </p>
          </div>
        </section>
      ) : (
        <section className="done past">
          <h2>{detail.cancelled ? 'このチェックインは取り消されました' : `${formatDate(detail.visitDate)}のチェックインです`}</h2>
          <p className="lead">今日の来場には使えません。受付のQRコードを読み取ってチェックインしてください。</p>
        </section>
      )}

      {live && detail.ticketsIssued > 0 && (
        <div className="alert warning" role="status">
          <p>ポイントがたまり、無料券が{detail.ticketsIssued}枚発行されました</p>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-label">いまのポイント</span>
          <span className="stat-value">
            {detail.balance}
            <small> / {detail.pointsPerTicket}</small>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">使える無料券</span>
          <span className="stat-value">
            {detail.unusedTickets}
            <small>枚</small>
          </span>
        </div>
      </div>
      <Link to="/" className="btn ghost">
        会員証にもどる
      </Link>
    </main>
  );
}
