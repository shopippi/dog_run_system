import { PHOTO_LIFF_PATHS } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionBar } from '../../components/ActionBar';
import { BusyLabel } from '../../components/BusyLabel';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PressButton } from '../../components/PressButton';
import { api } from '../../lib/api';
import { LineRow, LinesSkeleton, TotalBlock, goTo } from './checkout-parts';

// まねの支払いの画面(local・test・デモだけ。PU-5 の一部、段階1-C)。
// Stripe Checkout の代わり。GET /api/photos/mock-stripe/sessions/:id で金額と明細を出し、
// 「支払う」で POST .../pay(署名つきのまねの Webhook が送られる)→ 返ってきた redirectUrl(購入完了)へ。「やめる」で .../cancel → カートへ。
// 本物ではないことを画面の上に必ず書く(「練習用の支払いの画面です。お金は動きません」)。

type MockSession = {
  orderId: number;
  status: string;
  amount: number;
  lines: { label: string; unitPrice: number }[];
  successUrl: string;
  cancelUrl: string;
};

export function MockCheckoutPage() {
  const { sessionId = '' } = useParams();
  const [session, setSession] = useState<MockSession | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null);
  const navigate = useNavigate();
  const base = `/api/photos/mock-stripe/sessions/${encodeURIComponent(sessionId)}`;

  const load = useCallback(() => {
    setLoadError(null);
    api<MockSession>(base).then(setSession).catch(setLoadError);
  }, [base]);
  useEffect(load, [load]);

  const act = async (kind: 'pay' | 'cancel') => {
    setBusy(kind);
    setError(null);
    try {
      const r = await api<{ redirectUrl: string }>(`${base}/${kind}`, { method: 'POST', body: '{}' });
      goTo(r.redirectUrl, navigate);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  if (loadError && !session) return <main className="screen"><ErrorNotice error={loadError} onRetry={load} /></main>;
  if (!session) return <LinesSkeleton rows={2} />;

  const pending = session.status === 'pending';
  return (
    <main className="screen">
      <div className="page-head">
        <h2>お支払い</h2>
      </div>
      <div className="alert info" role="note">
        <p>練習用の支払いの画面です。お金は動きません。</p>
      </div>
      <ul className="rows co-lines no-thumb" aria-label="お支払いの明細">
        {session.lines.map((l, i) => (
          <LineRow key={i} title={l.label} price={l.unitPrice} />
        ))}
      </ul>
      <TotalBlock label="お支払いの合計(税込み)" count={`${session.lines.length}点`} total={session.amount} />
      {error ? <ErrorNotice error={error} /> : null}
      {pending ? (
        <ActionBar>
          <PressButton type="button" className="btn" onClick={() => act('pay')} disabled={busy !== null}>
            <BusyLabel busy={busy === 'pay'} busyText="支払っています…">
              支払う(練習)
            </BusyLabel>
          </PressButton>
          <button type="button" className="btn ghost" onClick={() => act('cancel')} disabled={busy !== null}>
            <BusyLabel busy={busy === 'cancel'} busyText="カートに戻っています…">
              やめてカートに戻る
            </BusyLabel>
          </button>
        </ActionBar>
      ) : (
        <>
          <p className="lead">この注文は、もうお支払いが済んでいるか、期限が切れています。</p>
          <Link to={PHOTO_LIFF_PATHS.order(session.orderId)} className="btn sub">
            注文を見る
          </Link>
        </>
      )}
    </main>
  );
}
