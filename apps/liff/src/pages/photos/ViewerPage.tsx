import { PHOTO_LIFF_PATHS, formatPhotoPrice, type GalleryAlbumDetail, type GalleryPhoto, type PhotoConfigResponse } from '@dr/shared';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MessageNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { PressButton } from '../../components/PressButton';
import { Skeleton, SkeletonScreen, SkeletonText } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useAuthedImage } from '../../hooks/useAuthedImage';
import { ApiError } from '../../lib/api';
import { addResultMessage, addToCart, useCart } from './gallery/cart';
import { useGalleryData } from './gallery/data';
import { CartLink, Freshness, GalleryProblem } from './gallery/parts';
import { useSwipe } from './viewer/useSwipe';
import './gallery.css';

// PU-4 写真ビューア(段階1-B)。透かし付きのプレビュー、スワイプで前後、カートに入れる(1枚ずつ。まとめて入れるのはアルバムのグリッドで選ぶ)
// - アルバムの写真の並びは、アルバム詳細で読んだもの(端末に残した内容)を使う。開いたらすぐ出る
// - プレビューが届くまでは、グリッドで読んだサムネイルを大きくして出す(電波が弱くても、何の写真かすぐ分かる)
// - 前後へは、画面を作り直さずに写真だけを替え、URL も書き換える(読み込み直しても同じ写真が開く)
// - 「前の写真」「次の写真」のボタンと、キーボードの ← → でも動かせる(スワイプできない人のため)

export function ViewerPage(_props: { config: PhotoConfigResponse }) {
  const params = useParams();
  const albumId = Number(params.albumId);
  const load = useGalleryData<GalleryAlbumDetail>(`/api/photos/albums/${albumId}`);
  if (load.error && !load.data) return <GalleryProblem error={load.error} onRetry={load.reload} />;
  if (!load.data) return <ViewerSkeleton />;
  return (
    <Viewer
      key={albumId}
      detail={load.data}
      initialPhotoId={Number(params.photoId)}
      freshness={load.failed || load.refreshing ? <Freshness refreshing={load.refreshing} failed={load.failed} onRetry={load.reload} /> : null}
    />
  );
}

function Viewer({ detail, initialPhotoId, freshness }: { detail: GalleryAlbumDetail; initialPhotoId: number; freshness: ReactNode }) {
  const { album, photos } = detail;
  const [photoId, setPhotoId] = useState(initialPhotoId);
  const index = photos.findIndex((p) => p.photoId === photoId);
  const photo = photos[index];
  const prev = index > 0 ? photos[index - 1]! : null;
  const next = index >= 0 && index < photos.length - 1 ? photos[index + 1]! : null;

  const go = (p: GalleryPhoto | null) => {
    if (!p) return;
    setPhotoId(p.photoId);
    // 画面は作り直さず、URL だけを書き換える(戻るボタンはアルバムへ。読み込み直すとこの写真が開く)
    const url = new URL(window.location.href);
    url.pathname = url.pathname.replace(/\/photos\/\d+$/, `/photos/${p.photoId}`);
    window.history.replaceState(window.history.state, '', url);
  };
  const swipe = useSwipe({ onPrev: prev ? () => go(prev) : null, onNext: next ? () => go(next) : null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
      if (e.key === 'ArrowLeft') go(prev);
      if (e.key === 'ArrowRight') go(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!photo) {
    return (
      <main className="screen ph-gallery">
        <MessageNotice message="この写真は見られなくなりました。お店が公開をやめた可能性があります。アルバムから選び直してください。" />
        <Link to={PHOTO_LIFF_PATHS.album(album.id)} className="btn sub">
          アルバムへ戻る
        </Link>
      </main>
    );
  }

  const stageStyle = { '--ph-ar': photo.width && photo.height ? `${photo.width} / ${photo.height}` : '3 / 2' } as CSSProperties;

  return (
    <main className="screen ph-gallery ph-viewer">
      {freshness}
      <div className="ph-title-row">
        <h2 className="ph-viewer-title">
          写真 <span className="ph-nums">{index + 1} / {photos.length}</span>
        </h2>
        <CartLink />
      </div>

      <div
        className={`ph-stage${swipe.dragging ? ' dragging' : ''}`}
        style={stageStyle}
        {...swipe.handlers}
        aria-roledescription="写真の切り替え"
      >
        <Stage photo={photo} index={index} dx={swipe.dx} />
      </div>
      {/* 次の写真を先に読んでおく(前は戻るときにはたいてい読んである) */}
      <Preload url={next?.previewUrl ?? null} />

      <div className="ph-viewer-nav">
        <button type="button" className="btn ghost ph-inline-btn" disabled={!prev} onClick={() => go(prev)}>
          <Icon name="chevron-left" />
          前の写真
        </button>
        <button type="button" className="btn ghost ph-inline-btn" disabled={!next} onClick={() => go(next)}>
          次の写真
          <Icon name="chevron-right" />
        </button>
      </div>

      <ViewerBuy key={photo.photoId} albumId={album.id} photo={photo} />

      <p className="note">写真には見本の文字が入っています。購入すると、文字のない元の写真をダウンロードできます。左右にスワイプすると、前後の写真を見られます。</p>
    </main>
  );
}

/** 写真の面。プレビューが届くまではサムネイル(グリッドで読んだもの)を大きくして出す */
function Stage({ photo, index, dx }: { photo: GalleryPhoto; index: number; dx: number }) {
  const preview = useAuthedImage(photo.previewUrl);
  const thumb = useAuthedImage(photo.thumbUrl);
  const src = preview ?? thumb;
  const style = { transform: dx ? `translateX(${dx}px)` : undefined };
  const label = `写真 ${index + 1}(見本の文字入り)`;
  return src ? (
    <img
      src={src}
      alt={label}
      className={preview ? 'ph-stage-img' : 'ph-stage-img low'}
      style={style}
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
    />
  ) : (
    <span className="ph-ph ph-stage-img" role="img" aria-label={`${label}を読み込んでいます`} style={style} />
  );
}

function Preload({ url }: { url: string | null }) {
  useAuthedImage(url);
  return null;
}

/** 価格と「カートに入れる」(購入済み・カートに入っているときは、その印) */
function ViewerBuy({ albumId, photo }: { albumId: number; photo: GalleryPhoto }) {
  const cart = useCart();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inCart = cart.photoIds.has(photo.photoId) || cart.albumIds.has(albumId);

  const add = async () => {
    setBusy(true);
    setProblem(null);
    const items = [{ kind: 'photo' as const, albumId, photoId: photo.photoId }];
    try {
      toast(addResultMessage(await addToCart(items), items));
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'カートに入れられませんでした。電波のよい場所で、もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ph-viewer-buy" aria-label="この写真を買う">
      <p className="ph-viewer-price">
        {formatPhotoPrice(photo.price)}
        <span className="ph-price-note">税込み</span>
      </p>
      {problem && <MessageNotice message={problem} />}
      {photo.purchased ? (
        <>
          <p className="ph-viewer-state">この写真は購入済みです。</p>
          <Link to={PHOTO_LIFF_PATHS.purchases} className="btn sub">
            購入した写真を見る
          </Link>
        </>
      ) : inCart ? (
        <>
          <p className="ph-viewer-state">この写真は、カートに入っています。</p>
          <Link to={PHOTO_LIFF_PATHS.cart} className="btn sub">
            カートを見る
          </Link>
        </>
      ) : (
        <PressButton type="button" className="btn" disabled={busy} onClick={add}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              カートに入れています…
            </>
          ) : (
            'カートに入れる'
          )}
        </PressButton>
      )}
    </section>
  );
}

function ViewerSkeleton() {
  return (
    <SkeletonScreen className="ph-gallery ph-viewer">
      <SkeletonText size={17} width={120} />
      <Skeleton height="min(62dvh, calc((100vw - 40px) * 2 / 3))" radius={0} className="ph-stage-sk" />
      <Skeleton height={44} radius={12} />
      <Skeleton height={52} radius={12} />
    </SkeletonScreen>
  );
}
