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
 * 現在時刻(秒まで)と動く背景で、スクリーンショットと見分けられるようにする(2章)。
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
    <main className="screen">
      {live ? (
        <section className="done live" aria-label="チェックイン完了">
          <p className="done-date">{formatDate(detail.visitDate)}</p>
          <p className="clock mono" aria-label="現在時刻">
            {clock}
          </p>
          {detail.usedTicket && <p className="used-ticket">無料券を使用</p>}
          <div className="faces">
            {detail.dogs.map((d) => (
              <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={76} />
            ))}
          </div>
          <p className="big">{detail.dogs.map((d) => d.name).join('・')}</p>
          <div className="chips">
            <span>{detail.dogs.length}頭</span>
            <span className="mono">{detail.memberNo}</span>
            {detail.pointsAwarded > 0 ? <span>+{detail.pointsAwarded}ポイント</span> : <span>ポイントは1日1回</span>}
          </div>
          <p className="done-note">チェックイン {detail.checkedInAt.slice(11, 16)}・受付でこの画面を見せてください</p>
        </section>
      ) : (
        <section className="done past">
          <p className="big">{detail.cancelled ? 'このチェックインは取り消されました' : `${formatDate(detail.visitDate)}のチェックインです`}</p>
          <p className="small">今日の来場には使えません。受付のQRコードを読み取ってチェックインしてください。</p>
        </section>
      )}

      {live && detail.ticketsIssued > 0 && (
        <div className="issued" role="status">
          ポイントがたまり、無料券が{detail.ticketsIssued}枚発行されました
        </div>
      )}

      <div className="panel">
        <div className="kv">
          <span>いまのポイント</span>
          <b>
            {detail.balance} / {detail.pointsPerTicket}
          </b>
        </div>
        <div className="kv">
          <span>使える無料券</span>
          <b>{detail.unusedTickets}枚</b>
        </div>
      </div>
      <Link to="/" className="btn sub as-link">
        会員証にもどる
      </Link>
    </main>
  );
}
