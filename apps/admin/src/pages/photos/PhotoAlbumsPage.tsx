import {
  ALBUM_KIND_LABELS,
  ALBUM_STATUS_LABELS,
  formatAlbumDate,
  formatPhotoPrice,
  type AdminAlbum,
  type AdminAlbumsResponse,
  type AlbumKind,
  type AlbumStatus,
  type BulkResult,
  type PriceListsResponse,
} from '@dr/shared';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BusyLabel } from '../../components/BusyLabel';
import { Dialog } from '../../components/Dialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { RadioSegment } from '../../components/SettingsKit';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useLoad } from '../../hooks/useLoad';
import { adminApi, adminPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { PhotoSalesFrame } from './PhotoSalesFrame';
import { jstToday, saleEndLabel } from './photo-admin-format';
import './photo-admin.css';

// PA-3 アルバム一覧(段階1-A。PF-1・PF-4)。状態・枚数・売上・販売終了日、まとめて公開。
// 下書きのアルバムを選んで「公開する」を押すと、お客さんに見えるようになる(まとめて公開は、トーストから元に戻せる)。

const STATUS_FILTERS: { value: '' | AlbumStatus; label: string }[] = [
  { value: '', label: 'すべて' },
  { value: 'draft', label: '下書き' },
  { value: 'published', label: '公開中' },
  { value: 'ended', label: '販売終了' },
];

export function PhotoAlbumsPage() {
  const { readOnly } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<'' | AlbumStatus>('');
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString();
  const albums = useLoad(() => adminApi<AdminAlbumsResponse>(`/photos/albums${query ? `?${query}` : ''}`), [query]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const searchId = useId();

  const data = albums.data?.albums;
  const publishable = (a: AdminAlbum) => a.status !== 'ended' && a.counts.draft > 0;
  const chosen = (data ?? []).filter((a) => selected.has(a.id) && publishable(a));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<BulkResult>('/photos/albums/publish', { albumIds: chosen.map((a) => a.id) });
      setSelected(new Set());
      await albums.reload();
      toast({
        message: r.skipped.length ? `${r.changed}冊を公開しました。公開できなかったアルバム: ${r.skipped.map((s) => s.reason).join(' ')}` : `${r.changed}冊のアルバムを公開しました。お客さんに見えるようになりました。`,
        undo: { auditId: r.auditId, doneMessage: '公開を取り消しました。下書きに戻りました。', onUndone: () => void albums.reload() },
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PhotoSalesFrame
      title="アルバム"
      howto="アルバムの状態と売上を見られます。下書きのアルバムを選んで「公開する」を押すと、お客さんに見えるようになります。写真を足すときは「アップロード」から。"
      aside={
        !readOnly && (
          <>
            <button type="button" className="btn sub" onClick={() => setCreating(true)}>
              アルバムを作る
            </button>
            <button type="button" className="btn" disabled={chosen.length === 0 || busy} onClick={() => void publish()}>
              <BusyLabel busy={busy} pending="公開しています…">
                {chosen.length ? `選んだ${chosen.length}冊を公開する` : '選んで公開する'}
              </BusyLabel>
            </button>
          </>
        )
      }
    >
      <div className="pa-toolbar">
        <div className="segment" role="tablist" aria-label="アルバムの状態">
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} type="button" role="tab" aria-selected={status === f.value} onClick={() => setStatus(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="field pa-search">
          <label htmlFor={searchId} className="sr-only">
            アルバムの名前で探す
          </label>
          <input id={searchId} type="search" placeholder="アルバムの名前で探す" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      {albums.error ? <ErrorNotice error={albums.error} onRetry={albums.reload} /> : null}
      <section className="panel list-panel" aria-label="アルバムの一覧">
        {!data && !albums.error ? (
          <ul className="pa-rows" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="pa-album">
                <span />
                <Skeleton w={56} h={56} r={6} />
                <span className="pa-row-body">
                  <Skeleton w={160} h={15} r={4} />
                  <Skeleton w={280} h={13} r={4} />
                </span>
              </li>
            ))}
          </ul>
        ) : data && data.length === 0 ? (
          <div className="empty">
            <p>{status || q ? '当てはまるアルバムはありません。' : 'まだアルバムがありません。写真の入ったフォルダを落とすと、アルバムができます。'}</p>
            {!status && !q && !readOnly && (
              <Link className="btn sub pa-empty-act" to="/photos/upload">
                写真をアップロードする
              </Link>
            )}
          </div>
        ) : (
          <ul className="pa-rows">
            {data?.map((a) => (
              <AlbumRow key={a.id} a={a} readOnly={readOnly} checked={selected.has(a.id)} selectable={publishable(a)} onToggle={() => toggle(a.id)} />
            ))}
          </ul>
        )}
      </section>
      {creating && (
        <CreateAlbumDialog
          onClose={() => setCreating(false)}
          onCreated={(id, name) => {
            setCreating(false);
            toast(`アルバム「${name}」を作りました。写真を足してください。`);
            void albums.reload();
            return id;
          }}
        />
      )}
    </PhotoSalesFrame>
  );
}

function AlbumRow({ a, readOnly, checked, selectable, onToggle }: { a: AdminAlbum; readOnly: boolean; checked: boolean; selectable: boolean; onToggle: () => void }) {
  const total = a.counts.draft + a.counts.published + a.counts.hidden;
  return (
    <li className={`pa-album${a.status === 'ended' ? ' off' : ''}`} aria-label={a.name}>
      <span className="pa-album-check">
        {!readOnly && selectable && (
          <input type="checkbox" checked={checked} aria-label={`「${a.name}」を選ぶ`} onChange={onToggle} />
        )}
      </span>
      {a.coverThumbUrl ? <img className="pa-cover" src={a.coverThumbUrl} alt="" loading="lazy" /> : <span className="pa-cover" aria-hidden="true" />}
      <span className="pa-row-body">
        <span className="pa-row-title">
          <Link to={`/photos/albums/${a.id}`} className="pa-album-name">
            {a.name}
          </Link>
          <span className={`badge${a.status === 'published' ? ' info' : ''}`}>{ALBUM_STATUS_LABELS[a.status]}</span>
        </span>
        <span className="sub-text pa-nums">
          {ALBUM_KIND_LABELS[a.kind]} · {formatAlbumDate(a.eventDate)} · {a.priceListName} · 写真 {total}枚
          {a.counts.draft > 0 && a.status !== 'draft' && <>(まだ公開していない写真 {a.counts.draft}枚)</>}
          {a.counts.hidden > 0 && <>(非公開 {a.counts.hidden}枚)</>}
        </span>
      </span>
      <span className="pa-album-side pa-nums">
        <span>
          <span className="pa-k">売上</span> {formatPhotoPrice(a.salesYen)}
          <span className="sub-text">(売れた写真 {a.soldPhotos}枚)</span>
        </span>
        <span className="sub-text">{saleEndLabel(a.status, a.saleEndsAt, jstToday())}</span>
      </span>
    </li>
  );
}

function CreateAlbumDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number, name: string) => void }) {
  const navigate = useNavigate();
  const lists = useLoad(() => adminApi<PriceListsResponse>('/photos/price-lists'), []);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AlbumKind>('event');
  const [date, setDate] = useState(jstToday());
  const [priceListId, setPriceListId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nameId = useId();
  const dateId = useId();
  const plId = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<{ album: AdminAlbum }>('/photos/albums', { name: name.trim(), kind, eventDate: date, ...(priceListId ? { priceListId } : {}) });
      onCreated(r.album.id, r.album.name);
      navigate(`/photos/albums/${r.album.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const active = (lists.data?.priceLists ?? []).filter((p) => p.status === 'active');
  return (
    <Dialog
      title="アルバムを作る"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || !name.trim() || !date} onClick={() => void submit()}>
            <BusyLabel busy={busy} pending="作っています…">
              作る
            </BusyLabel>
          </button>
        </>
      }
    >
      <div className="pa-form">
        <div className="field">
          <label htmlFor={nameId}>名前</label>
          <input id={nameId} value={name} maxLength={60} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <RadioSegment
          label="種類"
          options={[
            { value: 'date', label: '日付' },
            { value: 'event', label: 'イベント' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <div className="field">
          <label htmlFor={dateId}>開催日</label>
          <input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={plId}>価格表</label>
          <select id={plId} value={priceListId} onChange={(e) => setPriceListId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">種類ごとの既定</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}(1枚 {formatPhotoPrice(p.unitPrice)})
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
