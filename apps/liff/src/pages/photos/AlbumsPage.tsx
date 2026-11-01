import {
  ALBUM_KIND_LABELS,
  PHOTO_LIFF_PATHS,
  formatAlbumDate,
  formatPhotoPrice,
  type AlbumKind,
  type GalleryAlbum,
  type GalleryAlbumsResponse,
  type PhotoConfigResponse,
} from '@dr/shared';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChoiceGroup } from '../../components/ChoiceGroup';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Skeleton, SkeletonScreen, SkeletonText } from '../../components/Skeleton';
import { readSession, useGalleryData, writeSession } from './gallery/data';
import { AuthedImg, CartLink, Freshness, GalleryProblem, saleEndLabel } from './gallery/parts';
import './gallery.css';

// PU-2 アルバム一覧(段階1-B)。公開中のアルバム、「イベント」「日付」のタブ、年月の絞り込み、カバー写真。GET /api/photos/albums
// 一覧は1回だけ読み、タブと月の絞り込みは端末の中でする(電波が弱くても、押したらすぐ切り替わる)。選んだタブと月は覚えておく。
// 販売が終わったアルバムは、サーバーが返さないので一覧から消える。

type Kind = 'all' | AlbumKind;
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'event', label: ALBUM_KIND_LABELS.event },
  { value: 'date', label: ALBUM_KIND_LABELS.date },
];
type Filter = { kind: Kind; month: string };

const monthLabel = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;

export function AlbumsPage(_props: { config: PhotoConfigResponse }) {
  const load = useGalleryData<GalleryAlbumsResponse>('/api/photos/albums');
  const [filter, setFilterState] = useState<Filter>(() => readSession<Filter>('albums.filter') ?? { kind: 'all', month: '' });
  const setFilter = (f: Filter) => {
    setFilterState(f);
    writeSession('albums.filter', f);
  };
  const kindLabel = useId();
  const monthId = useId();

  const byKind = useMemo(
    () => (load.data?.albums ?? []).filter((a) => filter.kind === 'all' || a.kind === filter.kind),
    [load.data, filter.kind],
  );
  const months = useMemo(() => [...new Set(byKind.map((a) => a.eventDate.slice(0, 7)))].sort().reverse(), [byKind]);
  const month = months.includes(filter.month) ? filter.month : '';
  const shown = byKind.filter((a) => !month || a.eventDate.startsWith(`${month}-`));

  if (load.error && !load.data) return <GalleryProblem error={load.error} onRetry={load.reload} />;
  if (!load.data) return <AlbumsSkeleton />;
  const all = load.data.albums;

  return (
    <main className="screen ph-gallery">
      {(load.failed || load.refreshing) && <Freshness refreshing={load.refreshing} failed={load.failed} onRetry={load.reload} />}
      <div className="page-head">
        <div className="ph-title-row">
          <h2>写真</h2>
          <CartLink />
        </div>
        <p className="lead">お店で撮った写真を、イベントや日付ごとに見られます。気に入った写真を選んで買えます。</p>
      </div>

      {all.length > 0 && (
        <div className="ph-filters">
          <span id={kindLabel} className="sr-only">
            アルバムの種類
          </span>
          <ChoiceGroup options={KIND_OPTIONS} value={filter.kind} onChange={(kind) => setFilter({ kind, month: '' })} labelledBy={kindLabel} />
          {months.length > 1 && (
            <div className="field">
              <label htmlFor={monthId}>撮った月</label>
              <select id={monthId} value={month} onChange={(e) => setFilter({ ...filter, month: e.target.value })}>
                <option value="">すべての月</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {all.length === 0 ? (
        <EmptyState icon="image">いま見られるアルバムはありません。お店で撮った写真は、公開されるとここに並びます。</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState
          icon="image"
          action={
            <button type="button" className="btn sub" onClick={() => setFilter({ kind: 'all', month: '' })}>
              すべてのアルバムを見る
            </button>
          }
        >
          この条件のアルバムはありません。
        </EmptyState>
      ) : (
        <ul className="rows ph-albums" aria-label="アルバム">
          {shown.map((a) => (
            <AlbumRow key={a.id} album={a} />
          ))}
        </ul>
      )}

      <nav className="menu" aria-label="写真のメニュー">
        <div className="rows">
          <Link to={PHOTO_LIFF_PATHS.purchases}>
            <span>購入した写真</span>
            <Icon name="chevron-right" />
          </Link>
          <Link to={PHOTO_LIFF_PATHS.legal}>
            <span>特定商取引法に基づく表記・利用規約</span>
            <Icon name="chevron-right" />
          </Link>
        </div>
      </nav>
    </main>
  );
}

function AlbumRow({ album: a }: { album: GalleryAlbum }) {
  const end = saleEndLabel(a.saleEndsAt, true);
  return (
    <li>
      <Link to={PHOTO_LIFF_PATHS.album(a.id)} className="ph-album-row">
        <AuthedImg url={a.coverThumbUrl} alt="" className="ph-album-cover" />
        <span className="ph-album-body">
          <span className="ph-album-name">{a.name}</span>
          <span className="ph-album-meta">
            <span className="ph-nowrap">{ALBUM_KIND_LABELS[a.kind]}</span>
            {/* 日付のアルバムは名前が日付なので、同じ日付を2回出さない */}
            {a.name !== formatAlbumDate(a.eventDate) && <span className="ph-nowrap">{formatAlbumDate(a.eventDate)}</span>}
            <span className="ph-nowrap">{a.photoCount}枚</span>
            <span className="ph-nowrap">1枚 {formatPhotoPrice(a.unitPrice)}</span>
          </span>
          {end && <span className="ph-album-end">{end}</span>}
        </span>
        <Icon name="chevron-right" />
      </Link>
    </li>
  );
}

function AlbumsSkeleton() {
  return (
    <SkeletonScreen className="ph-gallery">
      <div className="page-head">
        <Skeleton width={96} height={37} />
        <SkeletonText lines={2} />
      </div>
      <Skeleton height={46} radius={12} />
      <div className="sk-rows rows ph-albums">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="ph-album-row">
            <Skeleton width={64} height={64} radius={8} />
            <span className="ph-album-body">
              <SkeletonText size={17} width="70%" />
              <SkeletonText size={13} width="90%" />
            </span>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
