import type { MeRegistered } from '@dr/shared';
import { Link, useNavigate } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useMe } from '../../hooks/useMe';
import { canScan, scanCheckinCode } from '../../lib/liff';

/** L-07 会員証(C-06)。リッチメニューから開くとこの画面になる(10.3) */
export function CardPage() {
  const { me, error, reload } = useMe();
  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={reload} /></main>;
  if (!me || !me.registered) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;
  return <Card me={me} />;
}

function Card({ me }: { me: MeRegistered }) {
  const { card, household } = me;
  const navigate = useNavigate();
  const stamps = Math.min(card.pointsPerTicket, 20);
  const filled = card.balance % card.pointsPerTicket;

  const startCheckin = async () => {
    if (card.todayVisitId) {
      navigate(`/checkin/done/${card.todayVisitId}`);
      return;
    }
    if (canScan()) {
      const k = await scanCheckinCode().catch(() => null);
      if (k) navigate(`/checkin?k=${encodeURIComponent(k)}`);
      return;
    }
    navigate('/checkin');
  };

  return (
    <main className="screen">
      <section className="member-card" aria-label="会員証">
        <div className="mc-head">
          <div className="faces">
            {card.dogs.map((d) => (
              <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={52} />
            ))}
          </div>
          <div>
            <p className="name">{household.displayName}</p>
            <p className="id mono">{household.memberNo}</p>
          </div>
        </div>
        <div
          className="stamps"
          role="img"
          aria-label={`ポイント ${filled} / ${card.pointsPerTicket}`}
          style={{ gridTemplateColumns: `repeat(${Math.min(stamps, 10)}, 1fr)` }}
        >
          {Array.from({ length: stamps }, (_, i) => (
            <span key={i} className={i < filled ? 'on' : ''} />
          ))}
        </div>
        <p className="mc-foot">
          <span>
            ポイント <b>{card.balance}</b>
          </span>
          <span>次の無料券まで あと{card.toNextTicket}ポイント</span>
        </p>
      </section>

      {card.tickets.length > 0 && (
        <div className="ticket-box">
          <div>
            <b>無料券 {card.tickets.length}枚</b>
            <p className="small">チェックインのときに「無料券を使う」を選んでください</p>
          </div>
          {card.tickets[0]?.expiresAt && (
            <span className="small">期限 {card.tickets[0].expiresAt.slice(0, 10).replace(/-/g, '/')}</span>
          )}
        </div>
      )}

      <button type="button" className="btn big-btn" onClick={startCheckin}>
        {card.todayVisitId ? '今日のチェックインを見る' : 'チェックイン(受付のQRを読む)'}
      </button>

      <nav className="menu" aria-label="メニュー">
        <Link to="/dogs">ワンちゃん</Link>
        <Link to="/family">家族を招待</Link>
      </nav>
      <p className="small muted center">1日1ポイント。{card.pointsPerTicket}ポイントで無料券1枚(来場1回分)。</p>
    </main>
  );
}
