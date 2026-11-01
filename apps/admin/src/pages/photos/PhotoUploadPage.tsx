import {
  ALBUM_KIND_LABELS,
  ALBUM_STATUS_LABELS,
  DEFAULT_SETTINGS,
  formatAlbumDate,
  photoWatermarkText,
  type AdminAlbumsResponse,
  type AlbumsFromFoldersResponse,
  type SettingsResponse,
} from '@dr/shared';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useLoad } from '../../hooks/useLoad';
import { adminApi, adminPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { PhotoSalesFrame } from './PhotoSalesFrame';
import { groupsFromDrop, groupsFromInput, type FolderGroup, type PickedFile } from './upload/folders';
import { closePreparePool } from './upload/process';
import { runQueue, uploadFile } from './upload/uploader';
import './upload/upload.css';

// PA-2 アップロード(段階1-A。PF-2)。
// - フォルダを落とす → フォルダの名前でアルバムを決める(日付か、イベントか。いくつも落とせば、いくつも作る)
// - いまあるアルバムの上に落とす・「写真を選ぶ」→ そのアルバムに足す
// - JPEG と HEIC だけを送る(ほかは飛ばして数を出す)。同じアルバムに同じ写真があれば飛ばす
// - ブラウザの中(Web Worker)で SHA-256・プレビュー・サムネイル・中サイズを作り、同時に4枚ずつ送る
// - 途中で止まったら、同じフォルダをもう一度落とすと、続きから送る

type Batch = {
  key: number;
  albumId: number;
  albumName: string;
  created: boolean;
  total: number;
  uploaded: number;
  duplicate: number;
  failed: number;
  /** JPEG・HEIC 以外で飛ばしたファイル */
  skipped: number;
  bytesTotal: number;
  bytesSent: number;
  failures: { name: string; message: string }[];
  state: 'running' | 'done' | 'stopped';
};

type Task = { batchKey: number; albumId: number; picked: PickedFile };

let batchSeq = 0;

export function PhotoUploadPage() {
  const { readOnly } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const albums = useLoad(() => adminApi<AdminAlbumsResponse>('/photos/albums'), []);
  const settings = useLoad(() => adminApi<SettingsResponse>('/settings').catch(() => null), []);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [over, setOver] = useState<number | 'main' | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const abort = useRef<AbortController | null>(null);
  const busy = batches.some((b) => b.state === 'running');
  const focusAlbum = Number(params.get('album')) || null;

  const watermark = photoWatermarkText(settings.data?.settings ?? DEFAULT_SETTINGS);

  // 送っている途中で画面を閉じようとしたら、確かめる
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  useEffect(
    () => () => {
      abort.current?.abort();
      closePreparePool();
    },
    [],
  );

  const patch = useCallback((key: number, fn: (b: Batch) => Partial<Batch>) => {
    setBatches((prev) => prev.map((b) => (b.key === key ? { ...b, ...fn(b) } : b)));
  }, []);

  const reloadAlbums = albums.reload;
  const run = useCallback(
    (plan: { albumId: number; albumName: string; created: boolean; group: FolderGroup }[]) => {
      const tasks: Task[] = [];
      const fresh: Batch[] = plan.map((p) => {
        const key = ++batchSeq;
        for (const picked of p.group.files) tasks.push({ batchKey: key, albumId: p.albumId, picked });
        return {
          key,
          albumId: p.albumId,
          albumName: p.albumName,
          created: p.created,
          total: p.group.files.length,
          uploaded: 0,
          duplicate: 0,
          failed: 0,
          skipped: p.group.skipped,
          bytesTotal: p.group.files.reduce((n, f) => n + f.file.size, 0),
          bytesSent: 0,
          failures: [],
          state: p.group.files.length ? 'running' : 'done',
        };
      });
      setBatches((prev) => [...fresh, ...prev]);
      // 落とした順に、1つずつ送る(同時に送るのは4枚まで)
      chain.current = chain.current.then(async () => {
        const ctrl = (abort.current = new AbortController());
        const sent = new Map<PickedFile, number>();
        await runQueue(tasks, async (t) => {
          if (ctrl.signal.aborted) return;
          const r = await uploadFile(
            t.albumId,
            t.picked,
            watermark,
            (bytes) => {
              const before = sent.get(t.picked) ?? 0;
              sent.set(t.picked, bytes);
              patch(t.batchKey, (b) => ({ bytesSent: b.bytesSent + (bytes - before) }));
            },
            ctrl.signal,
          );
          patch(t.batchKey, (b) => ({
            uploaded: b.uploaded + (r.outcome === 'uploaded' ? 1 : 0),
            duplicate: b.duplicate + (r.outcome === 'duplicate' ? 1 : 0),
            failed: b.failed + (r.outcome === 'failed' ? 1 : 0),
            failures: r.outcome === 'failed' ? [...b.failures, { name: t.picked.file.name, message: r.message ?? '' }] : b.failures,
          }));
        });
        const stopped = ctrl.signal.aborted;
        for (const b of fresh) patch(b.key, () => ({ state: stopped ? 'stopped' : 'done' }));
        if (!stopped && tasks.length) toast('写真を送り終えました。アルバムを開いて、公開してください。');
        void reloadAlbums();
      });
    },
    [reloadAlbums, patch, toast, watermark],
  );

  /** フォルダを落とした・選んだ: フォルダの名前でアルバムを決める */
  const onFolders = useCallback(
    async (groups: FolderGroup[]) => {
      setError(null);
      setNotice(null);
      const folders = groups.filter((g) => g.folder !== null);
      const loose = groups.filter((g) => g.folder === null);
      if (loose.some((g) => g.files.length + g.skipped > 0)) {
        setNotice('フォルダに入っていない写真は、送りませんでした。フォルダごと落とすか、下の「いまあるアルバムに足す」から選んでください。');
      }
      if (folders.length === 0) return;
      try {
        const r = await adminPost<AlbumsFromFoldersResponse>('/photos/albums/from-folders', { folders: folders.map((g) => g.folder!) });
        run(r.albums.map((a, i) => ({ albumId: a.albumId, albumName: a.name, created: a.created, group: folders[i]! })));
      } catch (e) {
        setError(e);
      }
    },
    [run],
  );

  /** いまあるアルバムに足す */
  const onAlbumFiles = useCallback(
    (albumId: number, albumName: string, groups: FolderGroup[]) => {
      setError(null);
      setNotice(null);
      const merged: FolderGroup = { folder: null, files: groups.flatMap((g) => g.files), skipped: groups.reduce((n, g) => n + g.skipped, 0) };
      run([{ albumId, albumName, created: false, group: merged }]);
    },
    [run],
  );

  const dropProps = (target: number | 'main', onDrop: (dt: DataTransfer) => void) => ({
    onDragOver: (e: DragEvent) => {
      if (readOnly || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setOver(target);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver((o) => (o === target ? null : o));
    },
    onDrop: (e: DragEvent) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      onDrop(e.dataTransfer);
    },
  });

  const openAlbums = (albums.data?.albums ?? []).filter((a) => a.status !== 'ended');

  return (
    <PhotoSalesFrame
      title="写真のアップロード"
      howto="写真の入ったフォルダを、ここに落としてください。フォルダの名前がアルバムの名前になります。途中で止まったときは、同じフォルダをもう一度落とすと、続きから送ります。"
    >
      {!readOnly && (
        <section
          className={`panel ph-up-drop${over === 'main' ? ' over' : ''}`}
          aria-label="フォルダを落とす場所"
          data-testid="photo-drop"
          {...dropProps('main', (dt) => void groupsFromDrop(dt).then(onFolders, setError))}
        >
          <p className="ph-up-drop-title">写真の入ったフォルダを、ここに落としてください</p>
          <p className="sub-text">
            フォルダの名前が「2026-11-03」のような日付なら日付のアルバム、それ以外ならイベントのアルバムになります。フォルダをいくつも落とすと、アルバムもいくつもできます。送るのは JPEG と HEIC の写真だけです。
          </p>
          <label className="btn sub ph-up-pick">
            フォルダを選ぶ
            <input
              type="file"
              multiple
              className="sr-only"
              aria-label="フォルダを選ぶ"
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                if (e.target.files?.length) void onFolders(groupsFromInput(e.target.files));
                e.target.value = '';
              }}
            />
          </label>
        </section>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      {notice && (
        <div className="alert warning" role="status">
          <p>{notice}</p>
        </div>
      )}

      {batches.length > 0 && (
        <section className="panel list-panel" aria-label="送っている写真">
          <div className="ph-up-head">
            <h2>送っている写真</h2>
            {busy && (
              <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>
                送るのを止める
              </button>
            )}
          </div>
          <ul className="ph-up-batches">
            {batches.map((b) => (
              <BatchRow key={b.key} b={b} />
            ))}
          </ul>
        </section>
      )}

      <section className="panel list-panel" aria-labelledby="ph-up-albums">
        <div className="ph-up-head">
          <h2 id="ph-up-albums">いまあるアルバムに足す</h2>
          <p className="sub-text">アルバムの上に写真やフォルダを落とすか、「写真を選ぶ」で選ぶと、そのアルバムに足します。</p>
        </div>
        {albums.error ? (
          <div className="ph-up-pad">
            <ErrorNotice error={albums.error} onRetry={albums.reload} />
          </div>
        ) : !albums.data ? (
          <ul className="ph-up-albums" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="ph-up-album">
                <Skeleton w={48} h={48} r={6} />
                <span className="ph-up-album-body">
                  <Skeleton w={160} h={14} r={4} />
                  <Skeleton w={220} h={12} r={4} />
                </span>
              </li>
            ))}
          </ul>
        ) : openAlbums.length === 0 ? (
          <p className="empty">まだアルバムがありません。フォルダを落とすと、アルバムができます。</p>
        ) : (
          <ul className="ph-up-albums">
            {openAlbums.map((a) => (
              <li
                key={a.id}
                className={`ph-up-album${over === a.id ? ' over' : ''}${focusAlbum === a.id ? ' focus' : ''}`}
                aria-label={a.name}
                {...dropProps(a.id, (dt) => void groupsFromDrop(dt).then((g) => onAlbumFiles(a.id, a.name, g), setError))}
              >
                {a.coverThumbUrl ? <img className="ph-up-cover" src={a.coverThumbUrl} alt="" /> : <span className="ph-up-cover" aria-hidden="true" />}
                <span className="ph-up-album-body">
                  <Link to={`/photos/albums/${a.id}`} className="ph-up-album-name">
                    {a.name}
                  </Link>
                  <span className="sub-text">
                    {ALBUM_KIND_LABELS[a.kind]} · {formatAlbumDate(a.eventDate)} · {ALBUM_STATUS_LABELS[a.status]} · 写真 {a.counts.draft + a.counts.published + a.counts.hidden}枚
                  </span>
                </span>
                {!readOnly && (
                  <label className="btn sub ph-up-pick">
                    写真を選ぶ
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/heic,image/heif,.jpg,.jpeg,.heic,.heif"
                      className="sr-only"
                      aria-label={`「${a.name}」に足す写真を選ぶ`}
                      onChange={(e) => {
                        if (e.target.files?.length) onAlbumFiles(a.id, a.name, groupsFromInput(e.target.files));
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PhotoSalesFrame>
  );
}

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)}KB` : `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)}MB`);

function BatchRow({ b }: { b: Batch }) {
  const finished = b.uploaded + b.duplicate + b.failed;
  const ratio = b.bytesTotal ? Math.min(1, b.bytesSent / b.bytesTotal) : b.state === 'done' ? 1 : 0;
  const stateText =
    b.state === 'running' ? '送っています' : b.state === 'stopped' ? '止めました' : b.failed ? '送り終えました(送れなかった写真があります)' : '送り終えました';
  return (
    <li className="ph-up-batch" aria-label={b.albumName}>
      <div className="ph-up-batch-top">
        <span className="ph-up-batch-name">
          <b>{b.albumName}</b>
          {b.created && <span className="badge">新しいアルバム</span>}
        </span>
        <span className="ph-up-batch-count">
          {finished} / {b.total}枚 · {stateText}
        </span>
      </div>
      <div
        className="ph-up-bar"
        role="progressbar"
        aria-label={`「${b.albumName}」の進み具合`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="sub-text ph-up-batch-meta">
        送った写真 {b.uploaded}枚
        {b.duplicate > 0 && <> · 同じ写真があったので飛ばした {b.duplicate}枚</>}
        {b.failed > 0 && <> · 送れなかった {b.failed}枚</>}
        {b.skipped > 0 && <> · JPEG・HEIC ではないので飛ばしたファイル {b.skipped}件</>}
        {b.bytesTotal > 0 && (
          <span className="ph-up-nowrap">
            {' '}
            · {mb(b.bytesSent)} / {mb(b.bytesTotal)}
          </span>
        )}
      </p>
      {b.failures.length > 0 && (
        <details className="ph-up-fail">
          <summary>送れなかった写真({b.failures.length}枚)</summary>
          <ul>
            {b.failures.map((f, i) => (
              <li key={i}>
                <span className="ph-up-fail-name">{f.name}</span>: {f.message}
              </li>
            ))}
          </ul>
          <p className="sub-text">同じフォルダをもう一度落とすと、送れなかった写真だけを送り直します。</p>
        </details>
      )}
      {b.state !== 'running' && (b.uploaded > 0 || b.duplicate > 0) && (
        <Link className="ph-up-open" to={`/photos/albums/${b.albumId}`}>
          「{b.albumName}」を開いて公開する
        </Link>
      )}
    </li>
  );
}
