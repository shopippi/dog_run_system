import { ActionBar } from '../components/ActionBar';
import { Skeleton, SkeletonBlock, SkeletonCircle, SkeletonScreen, SkeletonText, useSkeletonDelay } from '../components/Skeleton';

/*
 * 画面ごとの読み込み中の形(docs/design.md 11.1)。
 * 読み込み後の画面と同じ部品のクラス(page-head・rows・dog-row・stamp-panel など)の中に形を置き、
 * 高さと並びが読み込み後とほぼ同じになるようにする(読み込み後に画面ががたつかない)。
 */

/** ページの見出し(24/600)と説明(15) */
function HeadSk({ lead = 1, width = '42%' }: { lead?: number; width?: string }) {
  return (
    <div className="page-head">
      <SkeletonText size={24} lineHeight={1.35} width={width} />
      {lead > 0 ? <SkeletonText size={15} lines={lead} lastWidth="70%" /> : null}
    </div>
  );
}

/** 小さい見出し(13/600) */
const LabelSk = ({ width = '28%' }: { width?: string }) => <SkeletonText size={13} width={width} />;
/** 主ボタン・副ボタン(高さ 52、角丸 12) */
const ButtonSk = () => <Skeleton height={52} radius={12} />;

/** 下に固定した帯の主ボタン(帯そのものは本物と同じ) */
function BarSk() {
  const show = useSkeletonDelay();
  if (!show) return null;
  return (
    <ActionBar>
      <span aria-hidden="true" className="sk-bar-btn">
        <Skeleton height={52} radius={12} />
      </span>
    </ActionBar>
  );
}

/** アバター + 2 行の行(ワンちゃんの一覧など) */
function AvatarRowsSk({ count, avatar = 48, className = 'dog-row' }: { count: number; avatar?: number; className?: string }) {
  return (
    <div className="rows sk-rows" style={{ ['--row-inset' as string]: `${16 + avatar + 12}px` }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={className}>
          <SkeletonCircle size={avatar} />
          <span className="dog-row-body">
            <SkeletonText size={15} width={i % 2 ? '38%' : '30%'} />
            <SkeletonText size={13} width={i % 2 ? '52%' : '60%'} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** 文字だけの行(メニュー・使い方の一覧) */
function TextRowsSk({ count, height = 52 }: { count: number; height?: number }) {
  const widths = ['34%', '46%', '28%', '52%', '40%', '58%', '36%', '48%'];
  return (
    <div className="rows sk-rows">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-text-row" style={{ minHeight: height }}>
          <SkeletonText size={15} width={widths[i % widths.length]} />
        </div>
      ))}
    </div>
  );
}

/** 入力欄(ラベル + 高さ 48) */
function FieldSk({ label = '24%', height = 48 }: { label?: string; height?: number }) {
  return (
    <div className="field">
      <LabelSk width={label} />
      <Skeleton height={height} radius={12} />
    </div>
  );
}

/** 会員証のカード(1.58:1)と、その下のスタンプ・無料券・メニュー */
export function CardSkeleton() {
  return (
    <SkeletonScreen>
      <Skeleton className="sk-card" height="auto" />
      <ButtonSk />
      <div className="stamp-panel">
        <div className="stamp-head">
          <SkeletonText size={15} lineHeight={1.35} width="22%" />
          <SkeletonText size={14} width="14%" />
        </div>
        <div className="paws">
          <div className="paws-tier">
            <div className="paws-grid">
              {Array.from({ length: 10 }, (_, i) => (
                <SkeletonCircle key={i} size={36} />
              ))}
            </div>
          </div>
        </div>
        <SkeletonText size={15} width="72%" />
      </div>
      <div className="section tk-section">
        <SkeletonText size={15} lineHeight={1.35} width="18%" />
        <SkeletonText size={14} width="56%" />
      </div>
      <TextRowsSk count={3} />
    </SkeletonScreen>
  );
}

/** L-07b 会員証の背景を変える */
export function CardBackgroundSkeleton() {
  return (
    <SkeletonScreen>
      <HeadSk lead={2} width="40%" />
      <Skeleton className="sk-card" height="auto" />
      <div className="section cb-section">
        <LabelSk width="8%" />
        <div className="cb-swatches">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="cb-swatch">
              <SkeletonCircle size={40} />
            </span>
          ))}
        </div>
      </div>
      <div className="section cb-section">
        <LabelSk width="10%" />
        <Skeleton width={150} height={44} radius={12} />
      </div>
    </SkeletonScreen>
  );
}

/** L-05 チェックイン(犬を選ぶ行と主ボタン) */
export function CheckinSkeleton() {
  return (
    <SkeletonScreen>
      <HeadSk lead={2} width="34%" />
      <div className="pick-list">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="pick-row sk-pick-row">
            <Skeleton width={20} height={20} radius={4} />
            <SkeletonCircle size={40} />
            <span className="pick-body">
              <SkeletonText size={15} width={i ? '36%' : '28%'} />
              <SkeletonText size={13} width="40%" />
            </span>
          </div>
        ))}
      </div>
      <BarSk />
    </SkeletonScreen>
  );
}

/** L-06 チェックイン完了・使用できました(時計・バー・アバター・数値ブロック) */
export function DoneSkeleton({ avatars = true }: { avatars?: boolean }) {
  return (
    <SkeletonScreen className="done-screen">
      <div className="done">
        <div className="done-head">
          <SkeletonText size={13} width="34%" />
          <SkeletonText size={15} width="30%" />
          <span className="sk-clock">
            <SkeletonText size={40} lineHeight={1.1} width="52%" />
          </span>
        </div>
        <Skeleton className="sk-done-bar" height={3} radius={2} />
        <div className="done-body">
          {avatars ? <SkeletonCircle size={72} /> : <Skeleton height={64} radius={12} />}
          <SkeletonText size={20} lineHeight={1.35} width="40%" />
          <SkeletonText size={14} width="64%" />
          <SkeletonText size={13} width="80%" />
        </div>
      </div>
      <div className="stats">
        {Array.from({ length: avatars ? 2 : 1 }, (_, i) => (
          <div key={i} className="stat">
            <SkeletonText size={12} width="60%" />
            <SkeletonText size={24} lineHeight={1.25} width="44%" />
          </div>
        ))}
      </div>
      <Skeleton height={52} radius={12} className="sk-ghost" />
    </SkeletonScreen>
  );
}

/** L-09 ワンちゃんの一覧 */
export function DogsSkeleton() {
  return (
    <SkeletonScreen>
      <HeadSk lead={1} width="32%" />
      <AvatarRowsSk count={2} />
      <ButtonSk />
    </SkeletonScreen>
  );
}

/** 犬の入力欄のパネル(L-02・L-09) */
function DogFormSk({ breed = true }: { breed?: boolean }) {
  return (
    <div className="panel dog-form">
      <SkeletonText size={15} width="30%" />
      <div className="photo-pick">
        <SkeletonCircle size={72} />
        <div className="photo-pick-body sk-grow">
          <Skeleton width={180} height={44} radius={12} />
          <SkeletonText size={13} width="70%" />
        </div>
      </div>
      <FieldSk label="16%" />
      {breed ? <FieldSk label="16%" /> : null}
      {breed ? <FieldSk label="18%" height={44} /> : null}
      <FieldSk label="14%" height={44} />
      <FieldSk label="26%" />
    </div>
  );
}

/** L-09 ワンちゃんの変更・追加 */
export function DogFormSkeleton({ edit = true }: { edit?: boolean }) {
  return (
    <SkeletonScreen>
      <HeadSk lead={edit ? 2 : 0} width={edit ? '24%' : '46%'} />
      <DogFormSk breed={!edit} />
      <BarSk />
    </SkeletonScreen>
  );
}

/** L-02 犬の登録(登録の流れ) */
export function RegisterDogsSkeleton() {
  return (
    <SkeletonScreen>
      <Skeleton height={3} radius={2} />
      <HeadSk lead={2} width="48%" />
      <DogFormSk />
      <BarSk />
    </SkeletonScreen>
  );
}

/** アンケートの入力(選択肢のセグメント・チップ) */
function SurveyFieldsSk({ count }: { count: number }) {
  return (
    <div className="fields">
      {Array.from({ length: count }, (_, i) => (
        <FieldSk key={i} label={['14%', '12%', '26%', '34%'][i % 4]} height={i % 2 ? 44 : 96} />
      ))}
    </div>
  );
}

/** L-03 アンケート(登録の流れ) */
export function RegisterSurveySkeleton() {
  return (
    <SkeletonScreen>
      <Skeleton height={3} radius={2} />
      <HeadSk lead={2} width="52%" />
      <SurveyFieldsSk count={4} />
      <BarSk />
    </SkeletonScreen>
  );
}

/** L-10 プロフィール */
export function ProfileSkeleton() {
  return (
    <SkeletonScreen>
      <HeadSk lead={2} width="36%" />
      <div className="section prof-section">
        <SkeletonText size={15} width="26%" />
        <SurveyFieldsSk count={2} />
      </div>
      <div className="section prof-section">
        <SkeletonText size={15} width="28%" />
        <SurveyFieldsSk count={3} />
      </div>
      <BarSk />
    </SkeletonScreen>
  );
}

/** L-08 来場履歴(月の見出しと、日付・アバター・2 行の行を 5 つ) */
export function HistorySkeleton() {
  return (
    <SkeletonScreen>
      <HeadSk lead={2} width="30%" />
      <div className="section">
        <LabelSk width="22%" />
        <div className="rows sk-rows" style={{ ['--row-inset' as string]: '16px' }}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="hist-row">
              <span className="hist-date">
                <SkeletonText size={17} lineHeight={1.2} width="100%" />
                <SkeletonText size={12} lineHeight={1.2} width="70%" />
              </span>
              <SkeletonCircle size={36} />
              <span className="hist-body">
                <SkeletonText size={15} width={i % 2 ? '34%' : '26%'} />
                <SkeletonText size={13} width={i % 2 ? '62%' : '54%'} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}

/** 使い方・よくある質問 */
export function HelpSkeleton() {
  return (
    <SkeletonScreen>
      <HeadSk lead={1} width="56%" />
      <TextRowsSk count={8} />
    </SkeletonScreen>
  );
}

/** L-11 いまの家族(家族を招待の画面の下の一覧) */
export function FamilyMembersSkeleton() {
  return (
    <SkeletonBlock as="section" className="section fam-section">
      <SkeletonText size={15} width="22%" />
      <div className="rows sk-rows">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="fam-row">
            <SkeletonText size={15} width={i ? '24%' : '34%'} />
            <SkeletonText size={13} width="52%" />
          </div>
        ))}
      </div>
    </SkeletonBlock>
  );
}

/** L-11 家族を招待(画面全体。会員証の情報を読み込むあいだ) */
export function FamilySkeleton() {
  return (
    <SkeletonScreen>
      <HeadSk lead={3} width="34%" />
      <ButtonSk />
      <div className="section fam-section">
        <SkeletonText size={15} width="22%" />
        <div className="rows sk-rows">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="fam-row">
              <SkeletonText size={15} width={i ? '24%' : '34%'} />
              <SkeletonText size={13} width="52%" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}

/** L-12 招待を開いたとき(招待したおうちと、参加の入力) */
export function JoinSkeleton() {
  return (
    <SkeletonScreen>
      <div className="invite-from">
        <SkeletonCircle size={48} />
        <div className="sk-grow">
          <SkeletonText size={13} width="30%" />
          <SkeletonText size={17} width="56%" />
        </div>
      </div>
      <HeadSk lead={2} width="70%" />
      <SurveyFieldsSk count={2} />
      <BarSk />
    </SkeletonScreen>
  );
}

/** 開いた URL に合わせた形(会員証の情報を読み込むあいだ、App から使う) */
export function skeletonFor(path: string) {
  if (path === '/checkin') return <CheckinSkeleton />;
  if (path.startsWith('/checkin/done/')) return <DoneSkeleton />;
  if (path.startsWith('/tickets/')) return <DoneSkeleton avatars={false} />;
  if (path === '/dogs') return <DogsSkeleton />;
  if (path === '/dogs/new') return <DogFormSkeleton edit={false} />;
  if (/^\/dogs\/\d+$/.test(path)) return <DogFormSkeleton />;
  if (path === '/family') return <FamilySkeleton />;
  if (path === '/history') return <HistorySkeleton />;
  if (path === '/profile') return <ProfileSkeleton />;
  if (path === '/help') return <HelpSkeleton />;
  if (path === '/card/background') return <CardBackgroundSkeleton />;
  return <CardSkeleton />;
}
