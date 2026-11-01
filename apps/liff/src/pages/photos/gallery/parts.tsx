import { PHOTO_ERROR_CODES, PHOTO_LIFF_PATHS, toJstDate } from '@dr/shared';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../../../components/ErrorNotice';
import { PhotoUnavailable } from '../../../components/photos/PhotoUnavailable';
import { useAuthedImage } from '../../../hooks/useAuthedImage';
import { ApiError } from '../../../lib/api';
import { useCart } from './cart';

// ギャラリーの画面(PU-2〜PU-4)で共通に使う小さな部品

/** ヘッダーの近くに出すカートへの入口。入っている数を添える(読めないときは数を出さない) */
export function CartLink() {
  const { count } = useCart();
  return (
    <Link to={PHOTO_LIFF_PATHS.cart} className="ph-cart-link" aria-label={count ? `カート(${count}件)` : 'カート'}>
      <span>カート</span>
      {count ? <span className="ph-cart-count">{count}</span> : null}
    </Link>
  );
}

/** 前に開いたときの内容を出しているときの一言(会員証と同じ。docs/design.md 14章) */
export function Freshness({ refreshing, failed, onRetry }: { refreshing: boolean; failed: boolean; onRetry: () => void }) {
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
  return (
    <p className="freshness overlay" role="status">
      <span>
        {refreshing && <span className="spinner" aria-hidden="true" />}
        {refreshing ? '最新にしています…' : ''}
      </span>
    </p>
  );
}

/** 読み込めなかったとき。準備中(503)は「準備中」の画面、それ以外は「何が起きたか・次にどうするか」 */
export function GalleryProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === PHOTO_ERROR_CODES.unavailable) return <PhotoUnavailable />;
  const final = error instanceof ApiError && error.status === 404;
  return (
    <main className="screen ph-gallery">
      <ErrorNotice error={error} onRetry={final ? undefined : onRetry} />
      {final && (
        <Link to={PHOTO_LIFF_PATHS.albums} className="btn sub">
          写真の一覧へ
        </Link>
      )}
    </main>
  );
}

/** 認証つきの API から読む写真(誰でも開ける URL にしない)。長押しの保存の抑止は気休め */
export function AuthedImg({ url, alt, className }: { url: string | null; alt: string; className?: string }) {
  const src = useAuthedImage(url);
  return src ? (
    <img src={src} alt={alt} className={className} draggable={false} onContextMenu={(e) => e.preventDefault()} />
  ) : (
    <span className={`ph-ph${className ? ` ${className}` : ''}`} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} />
  );
}

/** 「2027年5月1日まで販売しています」(販売終了の日時の直前の日。0:00 に終わるときは前の日まで) */
export function saleEndLabel(iso: string | null, short = false): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const [y, m, d] = toJstDate(new Date(t - 1)).split('-').map(Number);
  return short ? `${y}年${m}月${d}日まで販売` : `${y}年${m}月${d}日まで販売しています`;
}
