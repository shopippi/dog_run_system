import { ORDER_STATUS_LABELS, formatPhotoPrice, type AdminOrderDetail, type RefundResponse } from '@dr/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BusyLabel } from '../../components/BusyLabel';
import { Dialog } from '../../components/Dialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Loading, Skeleton, SkeletonText } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useLoad } from '../../hooks/useLoad';
import { adminApi, adminPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/jst-format';
import { PhotoSalesFrame } from './PhotoSalesFrame';
import './orders.css';

// PA-6 注文の内容(段階1-C)。明細ごとの返金の可否、返金(条件の外は理由を書いて「条件の外で返金する」)、ダウンロードの記録(見るだけ)。
// 返金できるかの判定と権限は API が確かめる(製作者は見るだけ。画面でも返金の操作を出さない)

type Item = AdminOrderDetail['items'][number];

export function PhotoOrderDetail({ id }: { id: string }) {
  const { readOnly } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => adminApi<AdminOrderDetail>(`/photos/orders/${encodeURIComponent(id)}`), [id]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const back = (
    <Link to="/photos/orders" className="btn sub">
      注文の一覧へ
    </Link>
  );
  if (!data) {
    return (
      <PhotoSalesFrame title="注文の内容" howto="注文の明細と、返金・ダウンロードの記録です。" aside={back}>
        {error ? <ErrorNotice error={error} onRetry={reload} /> : <DetailSkeleton />}
      </PhotoSalesFrame>
    );
  }

  const { order, items, downloads } = data;
  const canRefund = !readOnly && (order.status === 'paid' || order.status === 'partially_refunded');
  const toggle = (itemId: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(itemId)) n.delete(itemId);
      else n.add(itemId);
      return n;
    });
  const chosen = items.filter((i) => selected.has(i.id));
  const labelOf = (photoId: number) => items.find((i) => i.photoId === photoId)?.label ?? `${items.find((i) => i.kind === 'album')?.albumName ?? ''} の写真`;

  return (
    <PhotoSalesFrame
      title={`注文 #${order.id}`}
      howto="注文の明細と、返金・ダウンロードの記録です。返金できるのは、購入から7日以内で、まだダウンロードしていない明細です。それ以外は、理由を書いて「条件の外で返金する」を選ぶと返金できます。"
      aside={back}
    >
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      <section className="panel" aria-label="注文のまとめ">
        <dl className="po-summary">
          <div>
            <dt>お客さん</dt>
            <dd>{order.customerName ?? '(名前なし)'}</dd>
          </div>
          <div>
            <dt>会員ID</dt>
            <dd className="mono">{order.memberNo ?? '会員ではないお客さん'}</dd>
          </div>
          <div>
            <dt>状態</dt>
            <dd>
              <span className="badge">{ORDER_STATUS_LABELS[order.status]}</span>
            </dd>
          </div>
          <div>
            <dt>お支払いの日時</dt>
            <dd>{order.paidAt ? formatDateTime(order.paidAt) : 'まだお支払いがありません'}</dd>
          </div>
          <div>
            <dt>合計</dt>
            <dd className="po-big">{formatPhotoPrice(order.amount)}</dd>
          </div>
          <div>
            <dt>返金した額</dt>
            <dd className="po-big">{formatPhotoPrice(order.refundedAmount)}</dd>
          </div>
          {order.paymentMode === 'mock' && (
            <div>
              <dt>お支払いの方法</dt>
              <dd>練習用の支払い(お金は動いていません)</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="panel list-panel" aria-labelledby="po-items-h">
        <div className="po-panel-head">
          <h2 id="po-items-h">明細({items.length}点)</h2>
          {canRefund && (
            <button type="button" className="btn sub" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
              選んだ明細を返金する{chosen.length > 0 ? `(${chosen.length}点)` : ''}
            </button>
          )}
        </div>
        <ul className="po-list">
          {items.map((it) => (
            <ItemRow key={it.id} it={it} selectable={canRefund} checked={selected.has(it.id)} onToggle={() => toggle(it.id)} />
          ))}
        </ul>
      </section>

      <section className="panel list-panel" aria-labelledby="po-dl-h">
        <div className="po-panel-head">
          <h2 id="po-dl-h">ダウンロードの記録</h2>
          <span className="sub-text">お支払いのあとに、この注文の写真を保存した記録です(見るだけ)</span>
        </div>
        {downloads.length === 0 ? (
          <p className="empty">まだダウンロードされていません。</p>
        ) : (
          <div className="po-dl-wrap">
            <table className="po-dl">
              <thead>
                <tr>
                  <th scope="col">日時</th>
                  <th scope="col">写真</th>
                  <th scope="col">保存のしかた</th>
                  <th scope="col">端末</th>
                </tr>
              </thead>
              <tbody>
                {downloads.map((d, i) => (
                  <tr key={i}>
                    <td className="mono">{formatDateTime(d.createdAt)}</td>
                    <td>{labelOf(d.photoId)}</td>
                    <td>{d.kind === 'zip' ? 'まとめて保存' : '1枚ずつ保存'}</td>
                    <td className="po-ua">{deviceOf(d.userAgent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirming && (
        <RefundDialog
          orderId={order.id}
          items={chosen}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            setSelected(new Set());
            toast(`${r.refundedItemIds.length}点を返金しました。お客さんはその写真を保存できなくなりました。`);
            void reload();
          }}
        />
      )}
    </PhotoSalesFrame>
  );
}

function ItemRow({ it, selectable, checked, onToggle }: { it: Item; selectable: boolean; checked: boolean; onToggle: () => void }) {
  const refunded = !!it.refundedAt;
  return (
    <li className={`po-item${selectable ? '' : ' no-check'}${refunded ? ' refunded' : ''}`}>
      {selectable && (
        <label className="check" aria-label={`${it.label}を返金に選ぶ`}>
          <input type="checkbox" checked={checked} disabled={refunded} onChange={onToggle} />
        </label>
      )}
      <span className="po-thumb" aria-hidden="true">
        {it.thumbUrl && <img src={it.thumbUrl} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />}
      </span>
      <span className="po-item-body">
        <b>{it.label}</b>
        <span className="sub-text">
          {it.kind === 'album' ? 'アルバムまるごと' : '写真1枚'} · ダウンロード {it.downloads}回
        </span>
      </span>
      <span className="po-num">{formatPhotoPrice(it.unitPrice)}</span>
      <span className="po-refund">
        {refunded ? (
          <>
            <b>返金済み({formatPhotoPrice(it.refundAmount ?? 0)})</b>
            <span>
              {formatDateTime(it.refundedAt!)}
              {it.refundReason ? ` · 理由: ${it.refundReason}` : ''}
            </span>
          </>
        ) : it.refund.eligible ? (
          <>
            <b>返金できます</b>
            {it.refund.deadline && <span>{formatDateTime(it.refund.deadline)} まで</span>}
          </>
        ) : (
          <span>{it.refund.reason}</span>
        )}
      </span>
    </li>
  );
}

function RefundDialog({ orderId, items, onClose, onDone }: { orderId: number; items: Item[]; onClose: () => void; onDone: (r: RefundResponse) => void }) {
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const outside = items.filter((i) => !i.refund.eligible);
  const total = items.reduce((s, i) => s + i.unitPrice, 0);
  const ready = reason.trim().length > 0 && (outside.length === 0 || override);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await adminPost<RefundResponse>(`/photos/orders/${orderId}/refund`, { itemIds: items.map((i) => i.id), reason: reason.trim(), override: outside.length > 0 && override }));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="返金する"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy || !ready} onClick={submit}>
            <BusyLabel busy={busy} pending="返金しています…">
              {formatPhotoPrice(total)}を返金する
            </BusyLabel>
          </button>
        </>
      }
    >
      <div className="po-dialog">
        <p>次の明細を返金します。お客さんは、返金した写真を保存できなくなります。返金は取り消せません。</p>
        <ul className="po-dialog-list">
          {items.map((i) => (
            <li key={i.id}>
              {i.label}(<span className="po-dialog-total">{formatPhotoPrice(i.unitPrice)}</span>)
            </li>
          ))}
        </ul>
        <div className="field">
          <label htmlFor="po-reason">返金の理由</label>
          <textarea id="po-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="例: 間違えて買ったと連絡があった" />
        </div>
        {outside.length > 0 && (
          <>
            <p>
              {outside.length}点は返金の条件(購入から7日以内・まだダウンロードしていない)に合いません。返金するときは、理由を書いて次に印を付けてください。理由は操作ログに残ります。
            </p>
            <label className="check">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              条件の外で返金する
            </label>
          </>
        )}
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    </Dialog>
  );
}

/** ブラウザの情報から、端末の名前だけを出す */
function deviceOf(ua: string | null): string {
  if (!ua) return '不明';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'そのほか';
}

function DetailSkeleton() {
  return (
    <Loading>
      <section className="panel">
        <div className="po-summary">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <SkeletonText size={12} w={60} />
              <SkeletonText size={15} w={100} />
            </div>
          ))}
        </div>
      </section>
      <section className="panel list-panel">
        <ul className="po-list">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="po-item no-check">
              <Skeleton w={48} h={48} r={6} />
              <span className="po-item-body">
                <SkeletonText size={15} w={160} />
                <SkeletonText size={13} w={120} />
              </span>
              <SkeletonText size={14} w={56} />
              <SkeletonText size={13} w={140} />
            </li>
          ))}
        </ul>
      </section>
    </Loading>
  );
}
