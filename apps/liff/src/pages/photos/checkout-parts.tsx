import { formatPhotoPrice } from '@dr/shared';
import type { ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { SkeletonScreen, Skeleton, SkeletonText } from '../../components/Skeleton';
import { useAuthedImage } from '../../hooks/useAuthedImage';
import './checkout.css';

// 段階1-C の画面(カート・まねの支払い・購入完了)で使う部品

/** 明細の1行。写真は認証つきの API から読む(誰でも開ける URL にしない) */
export function LineRow({
  thumbUrl,
  title,
  album,
  price,
  flag,
  muted = false,
  action,
}: {
  thumbUrl?: string | null;
  title: string;
  album?: string;
  price: number | null;
  /** 「アルバムまるごとに含まれています」「販売が終わりました」などの灰色の印 */
  flag?: string | null;
  muted?: boolean;
  action?: ReactNode;
}) {
  return (
    <li className={`co-line${muted ? ' muted' : ''}`}>
      {thumbUrl !== undefined && <Thumb url={thumbUrl} />}
      <span className="co-body">
        <b>{title}</b>
        {album && <span className="co-album">{album}</span>}
        {flag && <span className="badge co-flag">{flag}</span>}
      </span>
      <span className="co-side">
        {price !== null && <span className="co-price">{formatPhotoPrice(price)}</span>}
        {action}
      </span>
    </li>
  );
}

function Thumb({ url }: { url: string | null }) {
  const src = useAuthedImage(url);
  return (
    <span className="co-thumb" aria-hidden="true">
      {src && <img src={src} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()} />}
    </span>
  );
}

/** 合計の帯 */
export function TotalBlock({ label, count, total }: { label: string; count: string; total: number }) {
  return (
    <div className="co-total">
      <span className="co-total-label">
        {label}
        <span className="sub-text">{count}</span>
      </span>
      <span className="co-total-value">{formatPhotoPrice(total)}</span>
    </div>
  );
}

/** 明細の画面の読み込み中(見出し・行・合計) */
export function LinesSkeleton({ rows = 3, lead = true }: { rows?: number; lead?: boolean }) {
  return (
    <SkeletonScreen>
      <div className="page-head">
        <Skeleton width={140} height={30} />
        {lead && <SkeletonText lines={1} width="80%" />}
      </div>
      <div className="rows co-lines">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="co-line">
            <Skeleton width={56} height={56} radius={8} />
            <span className="co-body">
              <SkeletonText lines={2} width="70%" />
            </span>
          </div>
        ))}
      </div>
      <Skeleton height={70} radius={16} />
    </SkeletonScreen>
  );
}

/**
 * サーバーが返した URL へ移る。LIFF の中の画面(まねの支払い・購入完了・カート)は画面の中で移り、
 * Stripe Checkout(本番)はページごと移る
 */
export function goTo(url: string, navigate: NavigateFunction) {
  const m = /^(?:https?:\/\/[^/]+)?\/liff(\/photos(?:\/.*)?)$/.exec(url);
  if (m) navigate(m[1]!);
  else window.location.assign(url);
}
