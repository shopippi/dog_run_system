import {
  PHOTO_LIFF_PATHS,
  PHOTO_ZIP_MAX,
  formatAlbumDate,
  type DownloadResponse,
  type PhotoConfigResponse,
  type PurchasedPhoto,
  type PurchasesResponse,
} from '@dr/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionBar } from '../../components/ActionBar';
import { BottomSheet } from '../../components/BottomSheet';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PressButton } from '../../components/PressButton';
import { PhotoGrid } from '../../components/photos/PhotoGrid';
import { useToast } from '../../components/Toast';
import { useAuthedImage } from '../../hooks/useAuthedImage';
import { api, postJson } from '../../lib/api';
import { PhotoSkeleton } from './PhotoSkeleton';
import { saveDownload } from './purchased/save-file';
import './purchased/purchased.css';

// PU-7 購入した写真(段階1-D。PF-7)。アルバム別に、透かしなしの中サイズ(長辺2048px)で出す。
// - 写真を押すと大きく見られ、「原本をダウンロード」で撮ったままのファイル(押すたびに新しい5分の URL)
// - 「まとめてダウンロード」で写真を選び、1つの ZIP(無圧縮。中のファイルは原本と同じ)で受け取る
// - 販売が終わったアルバムの写真も、ずっとここに残る。本人が買った写真だけが出る(API が確かめる)

type Album = PurchasesResponse['albums'][number];
type Opened = { album: Album; photo: PurchasedPhoto };

export function PurchasedPage({ config }: { config: PhotoConfigResponse }) {
  const [data, setData] = useState<PurchasesResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [opened, setOpened] = useState<Opened | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const toast = useToast();
  const limit = config.downloadLimit;

  const load = useCallback(() => {
    setError(null);
    return api<PurchasesResponse>('/api/photos/purchases').then(setData).catch(setError);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => data?.albums.reduce((n, a) => n + a.photos.length, 0) ?? 0, [data]);

  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < PHOTO_ZIP_MAX) next.add(id);
      return next;
    });
  const selectAlbum = (album: Album, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const p of album.photos) {
        if (!on) next.delete(p.photoId);
        else if (next.size < PHOTO_ZIP_MAX) next.add(p.photoId);
      }
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
    setActionError(null);
  };

  /** 5分の URL をもらって、すぐ保存する。上限(429)などは、その場に理由を出す */
  const run = async (request: () => Promise<DownloadResponse>, done: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await saveDownload(await request());
      toast(done);
      void load();
      return true;
    } catch (e) {
      setActionError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const downloadOne = async (photoId: number) => {
    const ok = await run(
      () => api<DownloadResponse>(`/api/photos/purchases/${photoId}/download`, { method: 'POST', attempts: 1 }),
      'ダウンロードを始めました。',
    );
    if (ok) setOpened(null);
  };

  const downloadZip = async () => {
    const ids = [...selected];
    const ok = await run(
      () => postJson<DownloadResponse>('/api/photos/purchases/zip', { photoIds: ids }, { attempts: 1 }),
      `${ids.length}枚をまとめてダウンロードしています。`,
    );
    if (ok) stopSelecting();
  };

  if (error && !data) {
    return (
      <main className="screen">
        <ErrorNotice error={error} onRetry={() => void load()} />
      </main>
    );
  }
  if (!data) return <PhotoSkeleton />;

  return (
    <main className="screen pu-screen">
      <div className="page-head">
        <h2>購入した写真</h2>
        <p className="lead">購入した写真は、販売が終わったあとも、いつでもここからダウンロードできます。</p>
      </div>

      {total === 0 ? (
        <EmptyState
          icon="image"
          action={
            <Link className="btn sub pu-empty-link" to={PHOTO_LIFF_PATHS.albums}>
              写真を見る
            </Link>
          }
        >
          まだ購入した写真はありません。
        </EmptyState>
      ) : (
        <>
          {!selecting && total > 1 && (
            <button type="button" className="btn sub" onClick={() => setSelecting(true)}>
              まとめてダウンロード
            </button>
          )}
          {selecting && (
            <p className="sub-text pu-hint" role="status">
              ダウンロードする写真を選んでください({PHOTO_ZIP_MAX}枚まで)。1つのファイル(ZIP)にまとめて届きます。
            </p>
          )}
          {selecting && actionError ? <ErrorNotice error={actionError} /> : null}

          {data.albums.map((album) => {
            const allOn = album.photos.every((p) => selected.has(p.photoId));
            return (
              <section key={album.albumId} className="section pu-album" aria-label={album.name}>
                <div className="pu-album-head">
                  <div className="pu-album-title">
                    <h3 className="section-label">{album.name}</h3>
                    <span className="sub-text">
                      {album.name !== formatAlbumDate(album.eventDate) && (
                        <>
                          <span className="mono-num">{formatAlbumDate(album.eventDate)}</span>・
                        </>
                      )}
                      <span className="mono-num">{album.photos.length}枚</span>
                    </span>
                  </div>
                  {selecting && (
                    <button type="button" className="btn ghost pu-select-all" onClick={() => selectAlbum(album, !allOn)}>
                      {allOn ? '選ぶのをやめる' : '全部選ぶ'}
                    </button>
                  )}
                </div>
                <PhotoGrid
                  selecting={selecting}
                  onToggle={toggle}
                  onOpen={(id) => {
                    const photo = album.photos.find((p) => p.photoId === id);
                    if (photo) {
                      setActionError(null);
                      setOpened({ album, photo });
                    }
                  }}
                  items={album.photos.map((p) => ({
                    id: p.photoId,
                    url: p.viewUrl ?? '',
                    label: `${p.filename}${selecting ? '' : 'を開く'}`,
                    selected: selected.has(p.photoId),
                    badge: selecting && selected.has(p.photoId) ? '選択中' : null,
                  }))}
                />
              </section>
            );
          })}

          <p className="note">
            届くのは、撮ったままの画質のファイル(原本)です。ダウンロードは、写真1枚につき{limit.hours}時間で{limit.count}回までです。
          </p>
        </>
      )}

      {selecting && (
        <ActionBar>
          <PressButton type="button" className="btn" disabled={selected.size === 0 || busy} onClick={() => void downloadZip()}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                準備しています…
              </>
            ) : selected.size === 0 ? (
              '写真を選んでください'
            ) : (
              `選んだ${selected.size}枚をダウンロード`
            )}
          </PressButton>
          <button type="button" className="btn ghost" disabled={busy} onClick={stopSelecting}>
            やめる
          </button>
        </ActionBar>
      )}

      <BottomSheet
        open={opened !== null}
        onClose={() => setOpened(null)}
        busy={busy}
        cancelLabel="閉じる"
        title={opened?.photo.filename ?? ''}
        actions={
          opened ? (
            <PressButton
              type="button"
              className="btn"
              disabled={busy || opened.photo.downloadsRemaining === 0}
              onClick={() => void downloadOne(opened.photo.photoId)}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  準備しています…
                </>
              ) : (
                '原本をダウンロード'
              )}
            </PressButton>
          ) : null
        }
      >
        {opened && <OpenedPhoto opened={opened} limit={limit} />}
        {!selecting && actionError ? <ErrorNotice error={actionError} /> : null}
      </BottomSheet>
    </main>
  );
}

function OpenedPhoto({ opened, limit }: { opened: Opened; limit: PhotoConfigResponse['downloadLimit'] }) {
  const src = useAuthedImage(opened.photo.viewUrl);
  const left = opened.photo.downloadsRemaining;
  return (
    <div className="pu-opened">
      <div className="pu-view">
        {src ? <img src={src} alt={opened.photo.filename} draggable={false} /> : <span className="pu-view-ph" aria-hidden="true" />}
      </div>
      <p className="sub-text">
        {opened.album.name}・<span className="mono-num">{formatAlbumDate(opened.album.eventDate)}</span>
      </p>
      <p className="sub-text">
        {left > 0
          ? `あと${left}回ダウンロードできます(${limit.hours}時間で${limit.count}回まで)。`
          : `${limit.hours}時間で${limit.count}回ダウンロードしました。少し時間をおいてから、もう一度お試しください。`}
      </p>
    </div>
  );
}
