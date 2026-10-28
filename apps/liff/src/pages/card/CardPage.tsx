import type { MeRegistered } from '@dr/shared';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { MemberCard } from '../../components/MemberCard';

import { ProfileNudge } from '../../components/ProfileNudge';
import { useMe } from '../../hooks/useMe';
import { useFacilityName } from '../../hooks/useFacilityName';
import { canScan, scanCheckinCode } from '../../lib/liff';
import { StampPanel } from './StampPanel';
import { TicketPanel } from './TicketPanel';

/** L-07 会員証(C-06)。リッチメニューから開くとこの画面になる(10.3) */
export function CardPage() {
  const { me, error, reload } = useMe();
  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={reload} /></main>;
  if (!me || !me.registered) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;
  return <Card me={me} reload={reload} />;
}

function Card({ me, reload }: { me: MeRegistered; reload: () => Promise<void> }) {
  const { card, household } = me;
  const navigate = useNavigate();
  const facilityName = useFacilityName();
  const canExchange = card.balance >= card.pointsPerTicket;

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
      <MemberCard
        displayName={household.displayName}
        memberNo={household.memberNo}
        facilityName={facilityName}
        dogs={card.dogs}
        balance={card.balance}
        background={me.cardBackground}
      />

      {/* 交換のボタンが出ているときは、そちらを主ボタンにする(主ボタンは1画面に1つ) */}
      <button type="button" className={canExchange ? 'btn sub' : 'btn'} onClick={startCheckin}>
        {card.todayVisitId ? '今日のチェックインを見る' : 'チェックイン(受付のQRを読む)'}
      </button>

      <StampPanel card={card} memberNo={household.memberNo} onChanged={reload} />

      <TicketPanel card={card} onChanged={reload} />

      <ProfileNudge pending={me.optionalSurveyPending} />

      <nav className="menu rows" aria-label="メニュー">
        <Link to="/dogs">
          <span>ワンちゃん</span>
          <Icon name="chevron-right" />
        </Link>
        <Link to="/family">
          <span>家族を招待</span>
          <Icon name="chevron-right" />
        </Link>
        <Link to="/card/background">
          <span>背景を変える</span>
          <Icon name="chevron-right" />
        </Link>
        <Link to="/history">
          <span>来場履歴</span>
          <Icon name="chevron-right" />
        </Link>
        <Link to="/profile">
          <span>プロフィール</span>
          <Icon name="chevron-right" />
        </Link>
      </nav>
      <p className="note">
        1日1ポイント。{card.pointsPerTicket}ポイントで無料券1枚(来場1回分)と交換できます。前のポイントカードは、受付で見せると引き継げます。
      </p>
      <Link to="/help" className="cu-link">
        使い方・よくある質問
      </Link>
    </main>
  );
}
