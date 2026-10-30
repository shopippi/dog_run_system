import { LazyMotion, MotionConfig, domAnimation, m, useReducedMotion } from 'motion/react';
import { Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { AppHeader, type HeaderBack } from './components/AppHeader';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorNotice } from './components/ErrorNotice';
import { ToastProvider, useToast } from './components/Toast';
import { skeletonFor } from './pages/skeletons';
import { resetMe, useMe } from './hooks/useMe';
import { usePendingSurvey } from './hooks/usePendingSurvey';
import { CardPage } from './pages/card/CardPage';
import { useMergeNotice } from './hooks/useMergeNotice';
import { easeOut } from './lib/motion';
import { acknowledgeOutbox, resumeOutbox, subscribeOutbox } from './lib/checkin-outbox';

/**
 * 画面のファイルを分けて読み込む。会員証(いちばんよく開く画面)だけを最初に読み、ほかの画面は開いたときに読む
 * (電波が弱くても、会員証が早く出るように。要件定義書 15.3)。読めなかったときは2回まで読み直す。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy<T>(async () => {
    for (let i = 0; ; i++) {
      try {
        return await load();
      } catch (e) {
        if (i >= 2) throw e;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  });
}

const RegisterFlow = lazyPage(() => import('./pages/register/RegisterFlow').then((x) => ({ default: x.RegisterFlow })));
const CheckinPage = lazyPage(() => import('./pages/checkin/CheckinPage').then((x) => ({ default: x.CheckinPage })));
const CheckinDonePage = lazyPage(() => import('./pages/checkin/CheckinDonePage').then((x) => ({ default: x.CheckinDonePage })));
const DogEditPage = lazyPage(() => import('./pages/dogs/DogEditPage').then((x) => ({ default: x.DogEditPage })));
const DogNewPage = lazyPage(() => import('./pages/dogs/DogNewPage').then((x) => ({ default: x.DogNewPage })));
const DogsPage = lazyPage(() => import('./pages/dogs/DogsPage').then((x) => ({ default: x.DogsPage })));
const FamilyPage = lazyPage(() => import('./pages/family/FamilyPage').then((x) => ({ default: x.FamilyPage })));
const JoinPage = lazyPage(() => import('./pages/family/JoinPage').then((x) => ({ default: x.JoinPage })));
const SurveyPrompt = lazyPage(() => import('./pages/SurveyPrompt').then((x) => ({ default: x.SurveyPrompt })));
const HistoryPage = lazyPage(() => import('./pages/history/HistoryPage').then((x) => ({ default: x.HistoryPage })));
const ProfilePage = lazyPage(() => import('./pages/profile/ProfilePage').then((x) => ({ default: x.ProfilePage })));
const HelpPage = lazyPage(() => import('./pages/help/HelpPage').then((x) => ({ default: x.HelpPage })));
const MergeNoticeScreen = lazyPage(() =>
  import('./pages/family/MergeNoticeScreen').then((x) => ({ default: x.MergeNoticeScreen })),
);
const TicketUsedPage = lazyPage(() => import('./pages/tickets/TicketUsedPage').then((x) => ({ default: x.TicketUsedPage })));
const CardBackgroundPage = lazyPage(() =>
  import('./pages/card/CardBackgroundPage').then((x) => ({ default: x.CardBackgroundPage })),
);

export function App() {
  const { me, error, loading, reload } = useMe();
  const location = useLocation();
  const navigate = useNavigate();

  // 招待を開いたときは、登録の有無にかかわらず招待の画面を出す(C-12)
  const invite = location.pathname.startsWith('/invite/');
  let content: ReactNode;
  if (invite) {
    content = (
      <Routes>
        <Route
          path="/invite/:code"
          element={
            <JoinPage
              onJoined={() => {
                navigate('/', { replace: true });
                // 別のおうちに入った・まとめた。端末に残した前の会員証は使わない
                void resetMe();
              }}
            />
          }
        />
      </Routes>
    );
  } else if (loading && !me) {
    content = skeletonFor(location.pathname);
  } else if (error || !me) {
    content = (
      <main className="screen">
        <ErrorNotice error={error} onRetry={reload} />
      </main>
    );
  } else if (!me.registered) {
    content = <RegisterFlow me={me} onFinished={reload} />;
  } else {
    content = <Registered />;
  }

  return (
    <Shell>
      <AppHeader back={!invite && me?.registered ? backFor(location.pathname) : null} />
      <RouteView>
        {/* 画面ごとのエラーの境界と、分けて読み込む画面の読み込み中(その画面のスケルトン) */}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={skeletonFor(location.pathname)}>{content}</Suspense>
        </ErrorBoundary>
      </RouteView>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    // 動きは Motion の m 部品で付ける。使う機能だけを読み込み(LazyMotion + domAnimation)、
    // 動きを減らす設定では、位置や大きさの動きを止める(reducedMotion="user")
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <div className="app">{children}</div>
        </ToastProvider>
      </MotionConfig>
    </LazyMotion>
  );
}

/**
 * 画面の切り替え(docs/design.md 11.3・11.6)。新しい画面は 8px 下から 200ms でふわっと出る(Motion)。
 * 戻る(ブラウザの戻る・はじめに開いたとき)は動かさない。読み込み中の形から読み込み後への切り替えも動かさない
 * (同じ URL のあいだは同じ入れ物のまま)。動きを減らす設定では動かさない。
 */
function RouteView({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navType = useNavigationType();
  // はじめの表示は動かさない
  const [first, setFirst] = useState(true);
  useEffect(() => {
    setFirst(false);
  }, []);
  const reduce = useReducedMotion();
  const animate = !first && navType !== 'POP' && !reduce;
  return (
    <m.div
      key={location.pathname}
      className={`route${animate ? ' enter' : ''}`}
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOut}
    >
      {children}
    </m.div>
  );
}

/** 下の階層の画面では、ヘッダーに戻り先を出す */
function backFor(path: string): HeaderBack | null {
  if (path === '/dogs/new' || /^\/dogs\/\d+$/.test(path)) return { to: '/dogs', label: 'ワンちゃん' };
  if (path === '/dogs' || path === '/family' || path === '/checkin') return { to: '/', label: '会員証' };
  if (path === '/history') return { to: '/', label: '会員証' };
  if (path === '/profile') return { to: '/', label: '会員証' };
  if (path === '/help') return { to: '/', label: '会員証' };
  if (path === '/card/background') return { to: '/', label: '会員証' };
  return null;
}

/**
 * 前に送れなかったチェックインを、続きから送る(15.3)。チェックインの画面の外で送れたときは、
 * サーバーが受け付けたあとにだけ「チェックインできました」と知らせ、会員証を最新にする。
 */
function useOutboxRunner(onDone: () => void) {
  const toast = useToast();
  const location = useLocation();
  const onCheckin = location.pathname === '/checkin';
  useEffect(() => {
    resumeOutbox();
  }, []);
  useEffect(() => {
    if (onCheckin) return; // チェックインの画面では、その画面が完了の画面に進める
    return subscribeOutbox((s) => {
      if (s.kind === 'done') {
        acknowledgeOutbox();
        toast('チェックインできました。受付で会員証の「今日のチェックインを見る」を見せてください。');
        onDone();
      }
    });
  }, [onCheckin, toast, onDone]);
}

function Registered() {
  const survey = usePendingSurvey();
  const mergeNotice = useMergeNotice();
  const { reload } = useMe();
  useOutboxRunner(reload);
  if (mergeNotice.notice) return <MergeNoticeScreen notice={mergeNotice.notice} onDone={mergeNotice.dismiss} />;
  if (survey.questions && survey.questions.length > 0) {
    return <SurveyPrompt questions={survey.questions} onDone={survey.dismiss} />;
  }
  return (
    <Routes>
      <Route path="/checkin" element={<CheckinPage />} />
      <Route path="/checkin/done/:id" element={<CheckinDonePage />} />
      <Route path="/dogs" element={<DogsPage />} />
      <Route path="/family" element={<FamilyPage />} />
      <Route path="/dogs/new" element={<DogNewPage />} />
      <Route path="/dogs/:id" element={<DogEditPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/tickets/:id" element={<TicketUsedPage />} />
      <Route path="/card/background" element={<CardBackgroundPage />} />
      <Route path="*" element={<CardPage />} />
    </Routes>
  );
}
