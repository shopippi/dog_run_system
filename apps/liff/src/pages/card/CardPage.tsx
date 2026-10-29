import type { DogSummary, MeRegistered } from '@dr/shared';
import type { ReactNode } from 'react';
import { DogAvatar } from '../../components/DogAvatar';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { MemberCard } from '../../components/MemberCard';
import { PressButton } from '../../components/PressButton';

import { ProfileNudge } from '../../components/ProfileNudge';
import { useMe } from '../../hooks/useMe';
import { useFacilityName } from '../../hooks/useFacilityName';
import { canScan, scanCheckinCode } from '../../lib/liff';
import { CardSkeleton } from '../skeletons';
import { StampPanel } from './StampPanel';
import { TicketPanel } from './TicketPanel';

/** L-07 会員証(C-06)。リッチメニューから開くとこの画面になる(10.3) */
export function CardPage() {
  const { me, error, reload } = useMe();
  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={reload} /></main>;
  if (!me || !me.registered) return <CardSkeleton />;
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
        appear
      />

      {/* 交換のボタンが出ているときは、そちらを主ボタンにする(主ボタンは1画面に1つ) */}
      <PressButton type="button" className={canExchange ? 'btn sub' : 'btn'} onClick={startCheckin}>
        {card.todayVisitId ? '今日のチェックインを見る' : 'チェックイン(受付のQRを読む)'}
      </PressButton>

      <StampPanel card={card} memberNo={household.memberNo} onChanged={reload} />

      <TicketPanel card={card} onChanged={reload} />

      <ProfileNudge pending={me.optionalSurveyPending} />

      {/* まとまりの一覧(iOS の「設定」と同じ形。docs/design.md 11.3) */}
      <nav className="menu" aria-label="メニュー">
        <div className="rows">
          {/* ワンちゃんが主役: 行の右に、その子たちの顔を小さく並べる */}
          <MenuLink to="/dogs" aside={<DogFaces dogs={card.dogs} />}>
            ワンちゃん
          </MenuLink>
          <MenuLink to="/family">家族を招待</MenuLink>
          <MenuLink to="/card/background">背景を変える</MenuLink>
        </div>
        <div className="rows">
          <MenuLink to="/history">来場履歴</MenuLink>
          <MenuLink to="/profile">プロフィール</MenuLink>
          <MenuLink to="/help">使い方・よくある質問</MenuLink>
        </div>
      </nav>
      <p className="note">
        1日1ポイント。{card.pointsPerTicket}ポイントで無料券1枚(来場1回分)と交換できます。前のポイントカードは、受付で見せると引き継げます。
      </p>
    </main>
  );
}

function MenuLink({ to, children, aside }: { to: string; children: string; aside?: ReactNode }) {
  return (
    <Link to={to}>
      <span>{children}</span>
      {aside}
      <Icon name="chevron-right" />
    </Link>
  );
}

/** メニューの「ワンちゃん」の行の右に出す、犬の顔(読み上げは行の名前「ワンちゃん」だけにする) */
function DogFaces({ dogs }: { dogs: DogSummary[] }) {
  if (dogs.length === 0) return null;
  return (
    <span className="menu-faces stack" aria-hidden="true">
      {dogs.slice(0, 4).map((d) => (
        <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={32} />
      ))}
    </span>
  );
}
