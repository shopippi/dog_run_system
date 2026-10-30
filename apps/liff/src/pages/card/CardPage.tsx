import type { DogSummary, MeRegistered } from '@dr/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { DogAvatar } from '../../components/DogAvatar';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { MemberCard } from '../../components/MemberCard';
import { PressButton } from '../../components/PressButton';

import { OldCardNotice } from '../../components/OldCardNotice';
import { ProfileNudge } from '../../components/ProfileNudge';
import { useMe } from '../../hooks/useMe';
import { useOldCard } from '../../hooks/useOldCard';
import { useFacilityName } from '../../hooks/useFacilityName';
import { canScan, scanCheckinCode } from '../../lib/liff';
import { CardSkeleton } from '../skeletons';
import { outboxStatus, subscribeOutbox, type OutboxStatus } from '../../lib/checkin-outbox';
import { StampPanel } from './StampPanel';
import { TicketPanel } from './TicketPanel';

/** L-07 会員証(C-06)。リッチメニューから開くとこの画面になる(10.3) */
export function CardPage() {
  // 開くたびに最新にする。前に開いたときの内容が端末にあれば、それを先に出す(15.3)
  const { me, error, reload, stale, loading, refreshFailed } = useMe({ revalidate: true });
  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={reload} /></main>;
  if (!me || !me.registered) return <CardSkeleton />;
  return (
    <Card
      me={me}
      reload={reload}
      stale={stale}
      freshness={stale ? <Freshness refreshing={loading} failed={refreshFailed} onRetry={reload} /> : null}
    />
  );
}

/**
 * 前に開いたときの会員証を出しているときの、静かな一言(docs/design.md 14章)。
 * 最新にしているあいだは「最新にしています…」、電波が届かず最新にできなかったときは、そのことと「もう一度読み込む」。
 */
function Freshness({ refreshing, failed, onRetry }: { refreshing: boolean; failed: boolean; onRetry: () => void }) {
  if (failed) {
    return (
      <p className="freshness" role="status">
        <span>電波が弱いため、前に開いたときの内容です。</span>
        <button type="button" className="btn ghost" onClick={onRetry}>
          もう一度読み込む
        </button>
      </p>
    );
  }
  // 最新にしているあいだは、会員証の上の余白に重ねて出す(消えたときに会員証が動かないように)
  return (
    <p className="freshness overlay" role="status">
      <span>
        {refreshing && <span className="spinner" aria-hidden="true" />}
        {refreshing ? '最新にしています…' : ''}
      </span>
    </p>
  );
}

/** 送信を待っているチェックイン(電波が弱くて、まだ届いていない) */
function usePendingCheckin(): boolean {
  const [s, setS] = useState<OutboxStatus>(outboxStatus);
  useEffect(() => subscribeOutbox(setS), []);
  return s.kind === 'waiting' || s.kind === 'sending';
}

function Card({
  me,
  reload,
  stale,
  freshness,
}: {
  me: MeRegistered;
  reload: () => Promise<void>;
  stale: boolean;
  freshness: ReactNode;
}) {
  const { card, household } = me;
  const navigate = useNavigate();
  const facilityName = useFacilityName();
  const oldCard = useOldCard();
  const canExchange = card.balance >= card.pointsPerTicket;
  const pendingCheckin = usePendingCheckin();

  const startCheckin = async () => {
    if (pendingCheckin) {
      navigate('/checkin');
      return;
    }
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
    <main className="screen card-screen">
      {freshness}
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
        {pendingCheckin ? 'チェックインの送信を待っています' : card.todayVisitId ? '今日のチェックインを見る' : 'チェックイン(受付のQRを読む)'}
      </PressButton>

      {/* 前に開いたときの内容のあいだは動かさず、最新の内容が届いたら作り直して「ポポポン」「ポン」を決める */}
      <StampPanel key={stale ? 'stale' : 'fresh'} still={stale} card={card} memberNo={household.memberNo} onChanged={reload} />

      <TicketPanel card={card} onChanged={reload} />

      <OldCardNotice notice={oldCard.notice} onClose={oldCard.close} />

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
        1日1ポイント。{card.pointsPerTicket}ポイントで無料券1枚(来場1回分)と交換できます。
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
