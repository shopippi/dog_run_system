import type { MeRegistered } from '@dr/shared';
import { Link, useNavigate } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
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
          <div className="mc-who">
            <p className="mc-name">{household.displayName}</p>
            <p className="mc-id mono">{household.memberNo}</p>
          </div>
          <div className="stack">
            {card.dogs.map((d) => (
              <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={44} />
            ))}
          </div>
        </div>
        <div className="stamps" role="img" aria-label={`ポイント ${filled} / ${card.pointsPerTicket}`}>
          {Array.from({ length: stamps }, (_, i) => (
            <span key={i} className={i < filled ? 'on' : ''} />
          ))}
        </div>
        <div className="mc-foot">
          <p>
            ポイント <b>{card.balance}</b>
          </p>
          <p>あと{card.toNextTicket}ポイントで無料券</p>
        </div>
      </section>

      {card.tickets.length > 0 && (
        <div className="alert warning ticket-note">
          <p>
            <b>無料券 {card.tickets.length}枚</b>
            {card.tickets[0]?.expiresAt && (
              <span className="ticket-exp">期限 {card.tickets[0].expiresAt.slice(0, 10).replace(/-/g, '/')}</span>
            )}
          </p>
          <p className="note">チェックインのときに「無料券を使う」を選んでください</p>
        </div>
      )}

      <button type="button" className="btn" onClick={startCheckin}>
        {card.todayVisitId ? '今日のチェックインを見る' : 'チェックイン(受付のQRを読む)'}
      </button>

      <nav className="menu rows" aria-label="メニュー">
        <Link to="/dogs">
          <span>ワンちゃん</span>
          <Icon name="chevron-right" />
        </Link>
        <Link to="/family">
          <span>家族を招待</span>
          <Icon name="chevron-right" />
        </Link>
      </nav>
      <p className="note">1日1ポイント。{card.pointsPerTicket}ポイントで無料券1枚(来場1回分)。</p>
    </main>
  );
}
