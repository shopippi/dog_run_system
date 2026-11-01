import { PHOTO_LIFF_PATHS, type CartItemView, type CartResponse, type CheckoutResponse, type PhotoConfigResponse } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionBar } from '../../components/ActionBar';
import { BusyLabel } from '../../components/BusyLabel';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PressButton } from '../../components/PressButton';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { LineRow, LinesSkeleton, TotalBlock, goTo } from './checkout-parts';

// PU-5 カート(段階1-C)。サーバーのカート(GET /api/photos/cart)。行ごとに外す、まるごとに含まれる写真・買えなくなった写真の印、
// 合計(サーバーが計算)、「購入手続きへ」(POST /api/photos/checkout → Stripe Checkout へ移る。local・テスト・デモはまねの支払いの画面)
export function CartPage({ config }: { config: PhotoConfigResponse }) {
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const load = useCallback(() => {
    setLoadError(null);
    api<CartResponse>('/api/photos/cart').then(setCart).catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  const remove = async (item: CartItemView) => {
    setRemoving(item.id);
    setActionError(null);
    try {
      setCart(await api<CartResponse>(`/api/photos/cart/items/${item.id}`, { method: 'DELETE' }));
      toast('カートから外しました。');
    } catch (e) {
      setActionError(e);
    } finally {
      setRemoving(null);
    }
  };

  const checkout = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api<CheckoutResponse>('/api/photos/checkout', { method: 'POST', body: '{}' });
      goTo(res.checkoutUrl, navigate);
    } catch (e) {
      setActionError(e);
      // 買えるものがなくなった・中身が変わったときは、カートを読み直して印を見せる
      if (e instanceof ApiError && e.status === 409) load();
      setBusy(false);
    }
  };

  if (loadError && !cart) return <main className="screen"><ErrorNotice error={loadError} onRetry={load} /></main>;
  if (!cart) return <LinesSkeleton />;

  if (cart.items.length === 0) {
    return (
      <main className="screen">
        <div className="page-head">
          <h2>カート</h2>
        </div>
        <EmptyState
          icon="image"
          action={
            <Link to={PHOTO_LIFF_PATHS.albums} className="btn sub">
              アルバムを見る
            </Link>
          }
        >
          カートは空です。アルバムで写真を選んで「カートに入れる」を押してください。
        </EmptyState>
      </main>
    );
  }

  const excluded = cart.items.filter((i) => i.state !== 'ok').length;

  return (
    <main className="screen">
      <div className="page-head">
        <h2>カート</h2>
        <p className="lead">選んだ写真は、LINE を閉じてもカートに残ります。</p>
      </div>

      <ul className="rows co-lines" aria-label="カートの写真">
        {cart.items.map((item) => (
          <LineRow
            key={item.id}
            thumbUrl={item.thumbUrl}
            title={item.label}
            album={item.albumName}
            // まるごとの価格がなくなった行など、価格の分からない行は金額を出さない
            price={item.unitPrice > 0 ? item.unitPrice : null}
            flag={item.message}
            muted={item.state !== 'ok'}
            action={
              <button
                type="button"
                className="co-remove"
                onClick={() => remove(item)}
                disabled={removing !== null || busy}
                aria-label={`${item.label}をカートから外す`}
              >
                {removing === item.id ? '外しています…' : '外す'}
              </button>
            }
          />
        ))}
      </ul>

      <TotalBlock label="合計(税込み)" count={`${cart.payableCount}点`} total={cart.total} />

      {actionError ? <ErrorNotice error={actionError} /> : null}

      <div className="co-notes">
        {excluded > 0 && <p className="note">印の付いた写真は、購入手続きに入りません(お支払いの対象になりません)。</p>}
        <p className="note">購入から{config.refundDays}日以内で、まだ一度もダウンロードしていない写真は、返金を受け付けます。</p>
        <Link to={PHOTO_LIFF_PATHS.legal} className="co-legal-link">
          特定商取引法に基づく表記・利用規約
        </Link>
      </div>

      <ActionBar>
        <PressButton type="button" className="btn" onClick={checkout} disabled={busy || cart.payableCount === 0}>
          <BusyLabel busy={busy} busyText="お支払いの画面を開いています…">
            購入手続きへ
          </BusyLabel>
        </PressButton>
      </ActionBar>
    </main>
  );
}
