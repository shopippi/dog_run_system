import { ORDER_STATUS_LABELS_CUSTOMER, PHOTO_LIFF_PATHS, type MyOrder, type PhotoConfigResponse } from '@dr/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { api } from '../../lib/api';
import { LineRow, LinesSkeleton, TotalBlock } from './checkout-parts';

// PU-6 購入完了(段階1-C)。GET /api/photos/orders/:id。Webhook を待つ間は「お支払いを確かめています」(少し待って読み直す)。
// 確定したら「購入した写真」へ。この画面(Stripe の success_url)を開いただけでは確定しない(確定は署名を確かめた Webhook だけ)。

/** 読み直す間隔(ミリ秒)。はじめは短く、だんだん間を空ける */
const POLL_MS = [1000, 1500, 2000, 3000, 4000, 5000];
/** これだけ待っても確定しなければ、「時間がかかっています」を出す(読み直しは続ける) */
const SLOW_AFTER_MS = 30_000;

export function OrderPage({ config }: { config: PhotoConfigResponse }) {
  const { orderId = '' } = useParams();
  const [order, setOrder] = useState<MyOrder | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [slow, setSlow] = useState(false);
  const started = useRef(Date.now());
  const tries = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api<{ order: MyOrder }>(`/api/photos/orders/${encodeURIComponent(orderId)}`);
      setOrder(r.order);
      setError(null);
      return r.order;
    } catch (e) {
      setError(e);
      return null;
    }
  }, [orderId]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      const o = await load();
      if (!alive) return;
      if (o && o.status !== 'pending') return;
      if (Date.now() - started.current > SLOW_AFTER_MS) setSlow(true);
      // 読み直しは 10 分まで(LINE のお知らせでも分かる)
      if (Date.now() - started.current > 10 * 60_000) return;
      timer = window.setTimeout(tick, POLL_MS[Math.min(tries.current++, POLL_MS.length - 1)]);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [load]);

  if (error && !order) return <main className="screen"><ErrorNotice error={error} onRetry={() => void load()} /></main>;
  if (!order) return <LinesSkeleton rows={2} />;

  if (order.status === 'pending') {
    return (
      <main className="screen">
        <div className="page-head">
          <h2>お支払いを確かめています</h2>
          <p className="co-waiting" role="status">
            <span className="spinner" aria-hidden="true" />
            確かめられたら、この画面が自動で切り替わります。このままお待ちください。
          </p>
        </div>
        {slow && (
          <p className="lead">
            時間がかかっています。お支払いが済んでいれば、確定したときに LINE でもお知らせします。この画面を閉じても大丈夫です。
          </p>
        )}
        <OrderLines order={order} />
      </main>
    );
  }

  if (order.status === 'expired' || order.status === 'canceled') {
    return (
      <main className="screen">
        <div className="page-head">
          <h2>お支払いは完了していません</h2>
          <p className="lead">お支払いの期限が切れたか、取りやめになりました。写真はカートに残っています。もう一度、購入手続きをしてください。</p>
        </div>
        <Link to={PHOTO_LIFF_PATHS.cart} className="btn">
          カートに戻る
        </Link>
      </main>
    );
  }

  const paid = order.status === 'paid';
  return (
    <main className="screen">
      <div className="page-head">
        <h2>{paid ? 'ご購入ありがとうございます' : ORDER_STATUS_LABELS_CUSTOMER[order.status]}</h2>
        <p className="lead">
          {paid
            ? '購入した写真は「購入した写真」から、いつでも見たり保存したりできます。'
            : '返金した写真は、購入した写真の画面から保存できなくなりました。'}
        </p>
      </div>
      <OrderLines order={order} />
      <Link to={PHOTO_LIFF_PATHS.purchases} className="btn">
        購入した写真を見る
      </Link>
      <p className="note">
        購入から{config.refundDays}日以内で、まだ一度もダウンロードしていない写真は、返金を受け付けます。お店にご連絡ください。
      </p>
    </main>
  );
}

function OrderLines({ order }: { order: MyOrder }) {
  return (
    <>
      <ul className="rows co-lines no-thumb" aria-label="注文の明細">
        {order.lines.map((l, i) => (
          <LineRow key={i} title={l.label} album={l.albumName} price={l.unitPrice} />
        ))}
      </ul>
      <TotalBlock label="合計(税込み)" count={`注文番号 ${order.id}`} total={order.amount} />
    </>
  );
}
