import { ORDER_STATUSES, ORDER_STATUS_LABELS, formatPhotoPrice, type AdminOrderSummary, type AdminOrdersResponse, type OrderStatus } from '@dr/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Loading, SkeletonText } from '../../components/Skeleton';
import { useLoad } from '../../hooks/useLoad';
import { adminApi } from '../../lib/api';
import { formatDateTime } from '../../lib/jst-format';
import { PhotoOrderDetail } from './PhotoOrderDetail';
import { PhotoSalesFrame } from './PhotoSalesFrame';
import './orders.css';

// PA-6 注文(段階1-C)。注文の一覧・内容、返金(7日以内・ダウンロード前。条件の外は理由を書いて)、ダウンロードの記録。
// GET /admin/api/photos/orders(一覧)・/orders/:id(内容。PhotoOrderDetail)
export function PhotoOrdersPage() {
  const { id } = useParams();
  if (id) return <PhotoOrderDetail id={id} />;
  return <PhotoOrderList />;
}

type Filter = { status: OrderStatus | ''; q: string; from: string; to: string };

function PhotoOrderList() {
  const [filter, setFilter] = useState<Filter>({ status: '', q: '', from: '', to: '' });
  const [q, setQ] = useState('');
  const [more, setMore] = useState<AdminOrderSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);

  const query = (before?: number | null) => {
    const p = new URLSearchParams();
    if (filter.status) p.set('status', filter.status);
    if (filter.q) p.set('q', filter.q);
    if (filter.from) p.set('from', filter.from);
    if (filter.to) p.set('to', filter.to);
    if (before) p.set('before', String(before));
    return `/photos/orders${p.size ? `?${p}` : ''}`;
  };
  const { data, error, reload } = useLoad(() => adminApi<AdminOrdersResponse>(query()), [filter.status, filter.q, filter.from, filter.to]);
  useEffect(() => {
    setMore([]);
    setNextBefore(data?.nextBefore ?? null);
  }, [data]);

  // 探す言葉は、打ち終わってから(0.3秒)探す
  useEffect(() => {
    const t = window.setTimeout(() => setFilter((f) => (f.q === q.trim() ? f : { ...f, q: q.trim() })), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const loadMore = async () => {
    setMoreBusy(true);
    setMoreError(null);
    try {
      const r = await adminApi<AdminOrdersResponse>(query(nextBefore));
      setMore((m) => [...m, ...r.orders]);
      setNextBefore(r.nextBefore);
    } catch (e) {
      setMoreError(e);
    } finally {
      setMoreBusy(false);
    }
  };

  const orders = data ? [...data.orders, ...more] : [];
  return (
    <PhotoSalesFrame
      title="注文"
      howto="お客さんの注文を見られます。返金は、購入から7日以内で、まだダウンロードしていない写真だけです。注文を押すと、内容と返金・ダウンロードの記録を見られます。"
    >
      <div className="po-filter" role="group" aria-label="絞り込み">
        <div className="field">
          <label htmlFor="po-status">状態</label>
          <select id="po-status" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as OrderStatus | '' }))}>
            <option value="">すべての注文</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field po-q">
          <label htmlFor="po-q">お客さん・会員ID・注文番号</label>
          <input id="po-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="例: こむぎ、DR-000012、15" />
        </div>
        <div className="field">
          <label htmlFor="po-from">この日から</label>
          <input id="po-from" type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="po-to">この日まで</label>
          <input id="po-to" type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
        </div>
      </div>
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        error ? null : <ListSkeleton />
      ) : (
        <section className="panel list-panel" aria-label="注文の一覧">
          {orders.length === 0 ? (
            <p className="empty">{filter.status || filter.q || filter.from || filter.to ? 'この条件の注文はありません。' : 'まだ注文はありません。'}</p>
          ) : (
            <ul className="po-list">
              <ListHead />
              {orders.map((o) => (
                <li key={o.id}>
                  <OrderRow o={o} />
                </li>
              ))}
            </ul>
          )}
          {nextBefore && (
            <div className="po-more">
              <button type="button" className="btn sub" disabled={moreBusy} onClick={loadMore}>
                {moreBusy ? '読み込んでいます…' : 'もっと見る'}
              </button>
            </div>
          )}
          {moreError ? <ErrorNotice error={moreError} /> : null}
        </section>
      )}
    </PhotoSalesFrame>
  );
}

function ListHead() {
  return (
    <li className="po-row po-head list-head" aria-hidden="true">
      <span>注文番号・日時</span>
      <span>お客さん</span>
      <span>状態</span>
      <span className="po-num">点数</span>
      <span className="po-num">金額</span>
    </li>
  );
}

function OrderRow({ o }: { o: AdminOrderSummary }) {
  return (
    <Link to={`/photos/orders/${o.id}`} className="po-row" aria-label={`注文番号 ${o.id} ${o.customerName ?? ''} ${ORDER_STATUS_LABELS[o.status]} ${formatPhotoPrice(o.amount)}`}>
      <span className="po-no">
        <b>#{o.id}</b>
        <span>{formatDateTime(o.paidAt ?? o.createdAt)}</span>
      </span>
      <span className="po-who">
        <b>{o.customerName ?? '(名前なし)'}</b>
        <span className="sub-text">{o.memberNo ?? '会員ではないお客さん'}</span>
      </span>
      <span className="po-st">
        <span className="badge">{ORDER_STATUS_LABELS[o.status]}</span>
        {o.paymentMode === 'mock' && <span className="sub-text"> 練習</span>}
      </span>
      <span className="po-num po-count">{o.itemCount}点</span>
      <span className="po-amount">
        <b>{formatPhotoPrice(o.amount)}</b>
        {o.refundedAmount > 0 && <span>返金 {formatPhotoPrice(o.refundedAmount)}</span>}
      </span>
    </Link>
  );
}

function ListSkeleton() {
  return (
    <Loading>
      <section className="panel list-panel">
        <ul className="po-list">
          <ListHead />
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="po-row">
              <span className="po-no">
                <SkeletonText size={14} w={40} />
                <SkeletonText size={13} w={96} />
              </span>
              <span className="po-who">
                <SkeletonText size={15} w={[120, 90, 140, 100, 110][i]} />
                <SkeletonText size={13} w={80} />
              </span>
              <SkeletonText size={12} w={72} />
              <SkeletonText size={14} w={32} />
              <SkeletonText size={15} w={64} />
            </li>
          ))}
        </ul>
      </section>
    </Loading>
  );
}
