import {
  PHOTO_CART_MAX,
  PHOTO_LIFF_PATHS,
  formatAlbumDate,
  formatPhotoPrice,
  type CartItem,
  type GalleryAlbumDetail,
  type PhotoConfigResponse,
} from '@dr/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionBar } from '../../components/ActionBar';
import { EmptyState } from '../../components/EmptyState';
import { MessageNotice } from '../../components/ErrorNotice';
import { PressButton } from '../../components/PressButton';
import { Skeleton, SkeletonScreen, SkeletonText } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { addResultMessage, addToCart, useCart } from './gallery/cart';
import { readSession, useGalleryData, writeSession } from './gallery/data';
import { LazyPhotoGrid } from './gallery/LazyPhotoGrid';
import { CartLink, Freshness, GalleryProblem, saleEndLabel } from './gallery/parts';
import './gallery.css';

// PU-3 アルバム詳細(段階1-B)。サムネイルのグリッド(PhotoGrid)、複数選択して「カートに入れる」(POST /api/photos/cart/items にまとめて)、
// 購入済みの印、まるごと購入、販売終了日。GET /api/photos/albums/:id
// - 写真を押すとビューア(PU-4)。「選ぶ」を押すと選ぶ状態になり、押した写真に印が付く。下の帯の「カートに入れる」でまとめて入れる
// - 購入済み・カートに入っている写真は選べない(印を付けて、写真を薄くする)
// - 選んでいる途中の写真は、ビューアを開いて戻っても・画面を読み込み直しても残る(この端末のこのタブだけ)

type Selection = { on: boolean; ids: number[] };

export function AlbumPage(_props: { config: PhotoConfigResponse }) {
  const albumId = Number(useParams().albumId);
  const load = useGalleryData<GalleryAlbumDetail>(`/api/photos/albums/${albumId}`);
  if (load.error && !load.data) return <GalleryProblem error={load.error} onRetry={load.reload} />;
  if (!load.data) return <AlbumSkeleton />;
  return (
    <Album
      key={albumId}
      detail={load.data}
      freshness={load.failed || load.refreshing ? <Freshness refreshing={load.refreshing} failed={load.failed} onRetry={load.reload} /> : null}
    />
  );
}

function Album({ detail, freshness }: { detail: GalleryAlbumDetail; freshness: ReactNode }) {
  const { album, photos } = detail;
  const navigate = useNavigate();
  const toast = useToast();
  const cart = useCart();
  const selKey = `sel.${album.id}`;
  const [sel, setSelState] = useState<Selection>(() => readSession<Selection>(selKey) ?? { on: false, ids: [] });
  const setSel = (s: Selection) => {
    setSelState(s);
    writeSession(selKey, s.on || s.ids.length ? s : null);
  };
  const [busy, setBusy] = useState<'photos' | 'album' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const albumInCart = cart.albumIds.has(album.id);
  /** 選べない理由(購入済み・カートに入っている)。選べるなら null */
  const blocked = (p: (typeof photos)[number]) =>
    p.purchased ? '購入済み' : cart.photoIds.has(p.photoId) || albumInCart ? 'カートに入っています' : null;
  const selectable = useMemo(() => photos.filter((p) => !blocked(p)), [photos, cart]); // eslint-disable-line react-hooks/exhaustive-deps
  // 選んだあとに購入済み・カートに入ったものは、選んだものから外して数える
  const chosen = sel.ids.filter((id) => selectable.some((p) => p.photoId === id));
  const chosenTotal = chosen.reduce((sum, id) => sum + (photos.find((p) => p.photoId === id)?.price ?? 0), 0);

  const items = photos.map((p, i) => {
    const b = blocked(p);
    return {
      id: p.photoId,
      url: p.thumbUrl,
      label: `写真 ${i + 1}・${formatPhotoPrice(p.price)}${b ? `・${b}` : ''}`,
      badge: b === 'カートに入っています' ? 'カート' : b,
      selected: sel.on && chosen.includes(p.photoId),
    };
  });

  const toggle = (id: number) => {
    const p = photos.find((x) => x.photoId === id);
    if (!p) return;
    const b = blocked(p);
    if (b) {
      toast(b === '購入済み' ? 'この写真は購入済みです。購入した写真の画面から、いつでもダウンロードできます。' : 'この写真は、もうカートに入っています。');
      return;
    }
    if (chosen.includes(id)) setSel({ on: true, ids: chosen.filter((x) => x !== id) });
    else if (chosen.length >= PHOTO_CART_MAX) toast(`一度に選べるのは${PHOTO_CART_MAX}枚までです。先にカートに入れてから、続きを選んでください。`);
    else setSel({ on: true, ids: [...chosen, id] });
  };

  const add = async (cartItems: CartItem[], kind: 'photos' | 'album') => {
    setBusy(kind);
    setProblem(null);
    try {
      const res = await addToCart(cartItems);
      toast(addResultMessage(res, cartItems));
      if (kind === 'photos') setSel({ on: false, ids: [] });
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'カートに入れられませんでした。電波のよい場所で、もう一度お試しください。');
    } finally {
      setBusy(null);
    }
  };

  const end = saleEndLabel(album.saleEndsAt);
  const allChosen = selectable.length > 0 && chosen.length >= Math.min(selectable.length, PHOTO_CART_MAX);

  return (
    <main className={`screen ph-gallery${sel.on ? ' selecting' : ''}`}>
      {freshness}
      <div className="page-head">
        <div className="ph-title-row">
          <h2>{album.name}</h2>
          <CartLink />
        </div>
        <p className="lead">
          <span className="ph-nowrap">{formatAlbumDate(album.eventDate)}</span>
          {' · '}
          <span className="ph-nowrap">{album.photoCount}枚</span>
          {' · '}
          <span className="ph-nowrap">1枚 {formatPhotoPrice(album.unitPrice)}</span>
        </p>
        {end && <p className="note ph-sale-end">{end}</p>}
      </div>

      {album.albumPrice !== null && (detail.canBuyAlbum || albumInCart) && (
        <section className="ph-album-buy" aria-label="アルバムまるごと">
          <div className="ph-album-buy-text">
            <span className="ph-album-buy-title">アルバムまるごと</span>
            <span className="ph-album-buy-price">
              {formatPhotoPrice(album.albumPrice)}
              <span className="ph-price-note">{album.photoCount}枚</span>
            </span>
          </div>
          {albumInCart ? (
            <Link to={PHOTO_LIFF_PATHS.cart} className="btn sub">
              カートに入っています
            </Link>
          ) : (
            <button
              type="button"
              className="btn sub"
              disabled={busy !== null}
              onClick={() => add([{ kind: 'album', albumId: album.id }], 'album')}
            >
              {busy === 'album' ? <><span className="spinner" aria-hidden="true" />入れています…</> : 'まるごとカートに入れる'}
            </button>
          )}
        </section>
      )}

      {photos.length === 0 ? (
        <EmptyState icon="image">このアルバムには、いま見られる写真がありません。</EmptyState>
      ) : (
        <section className="ph-photos" aria-label="写真">
          <div className="ph-select-row">
            <p className="ph-select-status" role="status">
              {sel.on ? (chosen.length ? `${chosen.length}枚を選んでいます` : 'カートに入れる写真を押してください') : `${photos.length}枚の写真`}
            </p>
            {sel.on ? (
              <span className="ph-select-acts">
                {selectable.length > 1 && (
                  <button
                    type="button"
                    className="btn ghost ph-inline-btn"
                    onClick={() => setSel({ on: true, ids: allChosen ? [] : selectable.slice(0, PHOTO_CART_MAX).map((p) => p.photoId) })}
                  >
                    {allChosen ? '選び直す' : 'すべて選ぶ'}
                  </button>
                )}
                <button type="button" className="btn sub ph-inline-btn" onClick={() => setSel({ on: false, ids: [] })}>
                  やめる
                </button>
              </span>
            ) : (
              selectable.length > 0 && (
                <button type="button" className="btn sub ph-inline-btn" onClick={() => setSel({ on: true, ids: [] })}>
                  選ぶ
                </button>
              )
            )}
          </div>
          {problem && <MessageNotice message={problem} />}
          <LazyPhotoGrid
            items={items}
            selecting={sel.on}
            onToggle={toggle}
            onOpen={(id) => navigate(PHOTO_LIFF_PATHS.viewer(album.id, id))}
          />
          <p className="note">写真には見本の文字が入っています。購入すると、文字のない元の写真をダウンロードできます。</p>
        </section>
      )}

      {sel.on && (
        <ActionBar>
          <p className="ph-bar-sum" aria-hidden="true">
            {chosen.length ? `${chosen.length}枚 · ${formatPhotoPrice(chosenTotal)}` : 'まだ選んでいません'}
          </p>
          <PressButton type="button" className="btn" disabled={chosen.length === 0 || busy !== null} onClick={() => add(chosen.map((photoId) => ({ kind: 'photo', albumId: album.id, photoId })), 'photos')}>
            {busy === 'photos' ? (
              <>
                <span className="spinner" aria-hidden="true" />
                カートに入れています…
              </>
            ) : chosen.length ? (
              `選んだ${chosen.length}枚をカートに入れる`
            ) : (
              'カートに入れる'
            )}
          </PressButton>
        </ActionBar>
      )}
    </main>
  );
}

function AlbumSkeleton() {
  return (
    <SkeletonScreen className="ph-gallery">
      <div className="page-head">
        <Skeleton width="60%" height={37} />
        <SkeletonText width="80%" />
      </div>
      <Skeleton height={44} radius={12} />
      <div className="ph-grid">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="ph-cell sk" />
        ))}
      </div>
    </SkeletonScreen>
  );
}
