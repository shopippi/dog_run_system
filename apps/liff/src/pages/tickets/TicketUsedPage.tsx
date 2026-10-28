import { toJstIso, type TicketUseDetail } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
 * 「無料券を使用しました」の画面(C-06)。会員証の「使用する」を押したあとに出る。受付はこの画面を見て料金を調整する。
 * チェックイン完了(L-06)と同じ考え方で、現在時刻(秒まで)と流れ続ける細いバーで、スクリーンショットと見分けられるようにする。
 * 時計はサーバーの時刻に合わせる(スマホの時計がずれていても、受付で見分けられるように)。
 */
export function TicketUsedPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<TicketUseDetail | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const now = useClock();

  const load = useCallback(() => {
    setError(null);
    api<TicketUseDetail>(`/api/tickets/${id}`)
      .then((d) => {
        setDetail(d);
        const server = new Date(d.serverTime).getTime();
        // 時刻が読めないときや、ずれが小さいときは、スマホの時計をそのまま使う
        setOffset(Number.isFinite(server) && Math.abs(server - Date.now()) > 5000 ? server - Date.now() : 0);
      })
      .catch(setError);
  }, [id]);
  useEffect(load, [load]);

  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={load} /></main>;
  if (!detail) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;

  const clock = toJstIso(new Date(now.getTime() + offset)).slice(11, 19);

  return (
    <main className="screen done-screen">
      {detail.isToday ? (
        <section className="done live" aria-label="無料券を使用しました">
          <div className="done-head">
            <p className="done-status">
              <span className="pulse" aria-hidden="true" />
              無料券
            </p>
            <p className="done-date">{formatDate(detail.usedDate)}</p>
            <p className="clock" role="timer" aria-label="現在時刻">
              {clock}
            </p>
          </div>
          <div className="done-body">
            <p className="used-ticket">無料券を使用しました</p>
            <p className="done-names">{detail.householdName}</p>
            <p className="done-meta">
              <span className="mono">{detail.memberNo}</span>
              <span aria-hidden="true"> · </span>
              <span>
                使用 <span className="mono">{detail.usedAt.slice(11, 16)}</span>
              </span>
            </p>
            <p className="note">受付でこの画面を見せてください。来場1回分が無料になります。</p>
          </div>
        </section>
      ) : (
        <section className="done past">
          <h2>{formatDate(detail.usedDate)}に使った無料券です</h2>
          <p className="lead">今日の来場には使えません。未使用の無料券は、会員証の「使用する」から使ってください。</p>
        </section>
      )}

      <div className="stats tk-stats">
        <div className="stat">
          <span className="stat-label">のこりの無料券</span>
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
