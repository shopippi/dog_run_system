import { milestoneText, toJstIso, visitMilestone, type CheckinDetail } from '@dr/shared';
import { m, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useClock } from '../../hooks/useClock';
import { api } from '../../lib/api';
import { DoneSkeleton } from '../skeletons';
import { PawMark } from '../../components/PawStamp';
import { tapticPon } from '../../lib/motion';

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
  if (!detail) return <DoneSkeleton />;

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
            {/* 小さな記念: 来場の回数の節目(10・30・50・100回)に一言 */}
            {visitMilestone(detail.visitCount ?? 0) !== null ? (
              <p className="done-milestone">
                <PawMark size={16} className="done-milestone-mark" />
                {milestoneText(
                  detail.dogs.map((d) => d.name),
                  detail.visitCount,
                )}
              </p>
            ) : null}
            <p className="done-meta">
              <span>{detail.dogs.length}頭</span>
              <span aria-hidden="true"> · </span>
              <span className="mono">{detail.memberNo}</span>
              <span aria-hidden="true"> · </span>
              {detail.pointsAwarded > 0 ? (
                <span className="done-points">
                  +{detail.pointsAwarded}ポイント
                  <PointPon />
                </span>
              ) : (
                <span>ポイントは1日1回</span>
              )}
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


      {live && detail.balance >= detail.pointsPerTicket && (
        <div className="alert info">
          <p>ポイントが{detail.pointsPerTicket}以上たまっています。会員証の「無料券と交換する」から、無料券と交換できます。</p>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-label">いまのポイント</span>
          <span className="stat-value">
            {detail.balance}
            <small>ポイント</small>
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

/**
 * 「+1ポイント」の横に、小さな肉球のハンコを 1 つ「ポン」と押す(docs/design.md 11.6)。
 * 時計や流れるバーなど、受付で見分けるための動きとは別。動きを減らす設定では、最初から押された形で出す。
 */
function PointPon() {
  const reduce = useReducedMotion();
  const [pressAt] = useState(() => 380);
  useEffect(() => {
    if (reduce) return;
    const t = window.setTimeout(tapticPon, pressAt + 160);
    return () => window.clearTimeout(t);
  }, [reduce, pressAt]);
  if (reduce) {
    return (
      <span className="done-pon" data-pon="still">
        <PawMark size={22} className="pon-mark" />
      </span>
    );
  }
  return (
    <span className="done-pon" data-pon="play">
      <m.span
        className="paw-ink"
        aria-hidden="true"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0.12, 0], scale: [0.7, 2] }}
        transition={{ delay: (pressAt + 160) / 1000, duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <m.span
        style={{ display: 'block' }}
        initial={{ opacity: 0, scale: 2.2, rotate: -14 }}
        animate={{ opacity: [0, 1, 1, 1], scale: [2.2, 0.86, 1.04, 1], rotate: [-14, 0, 0, 0] }}
        transition={{ delay: pressAt / 1000, duration: 0.32, times: [0, 0.5, 0.78, 1], ease: ['easeIn', 'easeOut', 'easeInOut'] }}
      >
        <PawMark size={22} className="pon-mark" />
      </m.span>
    </span>
  );
}
