import { ORDER_STATUS_LABELS, formatPhotoPrice, type AdminOrderSummary, type PhotoDashboardResponse } from '@dr/shared';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { formatJstDateTime } from '../../components/SettingsKit';
import { Loading, SkeletonKpis, SkeletonText } from '../../components/Skeleton';
import { useLoad } from '../../hooks/useLoad';
import { adminApi } from '../../lib/api';
import { PhotoSalesFrame } from './PhotoSalesFrame';
import './dashboard/photo-dashboard.css';

// PA-1 ダッシュボード(段階1-D)。今月の売上・枚数、販売終了が近いアルバム、最新の注文。GET /admin/api/photos/dashboard
// 見た目は既存のダッシュボード・今日の来場と同じ(数値ブロックを1つのパネルに・一覧の行)。色は足さない。
// 販売期間を延ばすのは、アルバムの編集(PA-4)。準備中の理由は、枠(PhotoSalesFrame)がタブの下に出す。
export function PhotoDashboardPage() {
  const { data, error, reload } = useLoad(() => adminApi<PhotoDashboardResponse>('/photos/dashboard'), []);
  return (
    <PhotoSalesFrame title="写真販売" howto="今月の売上と、販売終了が近いアルバム、新しい注文を見られます。">
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? !error && <DashboardSkeleton /> : <Dashboard data={data} />}
    </PhotoSalesFrame>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

function Dashboard({ data }: { data: PhotoDashboardResponse }) {
  return (
    <div className="pd-page">
      <section className="panel summary" aria-label={`${monthLabel(data.month)}の集計`}>
        <div className="kpis pd-kpis">
          <Kpi label={`${monthLabel(data.month)}の売上(返金を引いた額)`} value={data.salesYen.toLocaleString('ja-JP')} unit="円" />
          <Kpi label="売れた写真" value={String(data.soldPhotos)} unit="枚" />
          <Kpi label="注文" value={String(data.orders)} unit="件" />
        </div>
      </section>

      <section className="panel list-panel" aria-labelledby="pd-ending">
        <div className="pd-panel-head">
          <h2 id="pd-ending">販売終了が近いアルバム</h2>
          <span className="sub-text">販売が終わった翌晩に、売れなかった写真のファイルが消えます。続けるときは、販売期間を延ばしてください。</span>
        </div>
        {data.endingSoon.length === 0 ? (
          <p className="empty">近いうちに販売が終わるアルバムはありません。</p>
        ) : (
          <ul className="pd-list">
            {data.endingSoon.map((a) => (
              <li key={a.albumId} className="pd-row">
                <span className="pd-row-body">
                  <b>{a.name}</b>
                  <span className="sub-text">
                    <span className="pd-nowrap">{formatJstDateTime(a.saleEndsAt)}に販売終了</span>・
                    <span className="pd-nowrap">売れていない写真 {a.unsoldPhotos}枚</span>
                  </span>
                </span>
                <span className="pd-row-side">
                  <Link className="pd-link" to={`/photos/albums/${a.albumId}`}>
                    販売期間を延ばす
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel list-panel" aria-labelledby="pd-orders">
        <div className="pd-panel-head">
          <h2 id="pd-orders">新しい注文</h2>
          <Link className="pd-link" to="/photos/orders">
            注文をすべて見る
          </Link>
        </div>
        {data.recentOrders.length === 0 ? (
          <p className="empty">まだ注文はありません。</p>
        ) : (
          <ul className="pd-list">
            {data.recentOrders.map((o) => (
              <OrderRow key={o.id} o={o} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OrderRow({ o }: { o: AdminOrderSummary }) {
  const net = o.amount - o.refundedAmount;
  return (
    <li className="pd-row">
      <span className="pd-row-body">
        <b>
          {o.customerName ?? 'お名前なし'}
          {o.memberNo && <span className="sub-text"> ・{o.memberNo}</span>}
        </b>
        <span className="sub-text">
          <span className="pd-nowrap">{formatJstDateTime(o.paidAt ?? o.createdAt)}</span>・<span className="pd-nowrap">{o.itemCount}点</span>
          {o.paymentMode === 'mock' && <span className="pd-nowrap">・練習用の支払い</span>}
        </span>
      </span>
      <span className="pd-row-side">
        {o.status !== 'paid' && <span className="badge">{ORDER_STATUS_LABELS[o.status]}</span>}
        <span className="pd-amount">{formatPhotoPrice(net)}</span>
        <Link className="pd-link" to={`/photos/orders/${o.id}`} aria-label={`注文 ${o.id} の内容`}>
          内容
        </Link>
      </span>
    </li>
  );
}

function Kpi({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      <span className="v">
        {value}
        <small>{unit}</small>
      </span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <Loading>
      <div className="pd-page">
        <section className="panel summary">
          <SkeletonKpis n={3} className="kpis pd-kpis" />
        </section>
        {[0, 1].map((i) => (
          <section key={i} className="panel list-panel">
            <div className="pd-panel-head">
              <SkeletonText size={15} w={160} />
            </div>
            {[0, 1].map((j) => (
              <div key={j} className="pd-row">
                <span className="pd-row-body">
                  <SkeletonText size={14} w={140} />
                  <SkeletonText size={13} w={240} />
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Loading>
  );
}
