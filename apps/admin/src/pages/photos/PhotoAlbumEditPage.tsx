import {
  ALBUM_KIND_LABELS,
  ALBUM_PHOTO_STATUS_LABELS,
  ALBUM_STATUS_LABELS,
  formatAlbumDate,
  formatPhotoPrice,
  type AdminAlbumDetail,
  type AdminAlbumPhoto,
  type AdminAlbumsResponse,
  type AlbumKind,
  type AlbumPhotoStatus,
  type AlbumPhotosBulkInput,
  type BulkResult,
  type PriceListsResponse,
} from '@dr/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BusyLabel } from '../../components/BusyLabel';
import { Dialog } from '../../components/Dialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { RadioSegment } from '../../components/SettingsKit';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useLoad } from '../../hooks/useLoad';
import { ApiError, adminApi, adminPatch, adminPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AdminPhotoGrid } from './AdminPhotoGrid';
import { PhotoSalesFrame } from './PhotoSalesFrame';
import { endOfDayIso, formatJstDay } from './photo-admin-format';
import './photo-admin.css';

// PA-4 アルバム編集(段階1-A。PF-1・PF-3・PF-4)。
// - 名前・種類・開催日・価格表・販売終了の日(延長)
// - 写真のグリッド(押して選ぶ・Shift で範囲)→ 価格を変える・価格表に戻す・公開・非公開・ほかのアルバムへ(移す・コピー)・アルバムから外す
//   売れた写真は外せない(非公開になる)。一括操作はトーストの「元に戻す」で戻せる
// - 公開する(下書きの写真をまとめて公開。販売終了の日が決まる)

type Filter = 'all' | AlbumPhotoStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'draft', label: '下書き' },
  { value: 'published', label: '公開中' },
  { value: 'hidden', label: '非公開' },
];

export function PhotoAlbumEditPage() {
  const id = Number(useParams().id);
  const { readOnly } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const detail = useLoad(() => adminApi<AdminAlbumDetail>(`/photos/albums/${id}`), [id]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [dialog, setDialog] = useState<'price' | 'move' | 'remove' | 'removeAlbum' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const anchor = useRef<number | null>(null);

  const album = detail.data?.album;
  const photos = detail.data?.photos ?? [];
  const shown = filter === 'all' ? photos : photos.filter((p) => p.status === filter);
  const chosen = photos.filter((p) => selected.has(p.photoId));

  // 読み込み直したら、もう無い写真の選択を外す
  useEffect(() => {
    const ids = new Set(photos.map((p) => p.photoId));
    setSelected((prev) => new Set([...prev].filter((x) => ids.has(x))));
  }, [detail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (photoId: number, e: React.MouseEvent) => {
    if (readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && anchor.current !== null) {
        const ids = shown.map((p) => p.photoId);
        const a = ids.indexOf(anchor.current);
        const b = ids.indexOf(photoId);
        if (a >= 0 && b >= 0) {
          for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
          return next;
        }
      }
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      anchor.current = photoId;
      return next;
    });
  };

  const bulk = async (input: AlbumPhotosBulkInput, done: (r: BulkResult) => string) => {
    setBusy(input.action);
    setError(null);
    try {
      const r = await adminPost<BulkResult>(`/photos/albums/${id}/photos/bulk`, input);
      setDialog(null);
      setSelected(new Set());
      await detail.reload();
      const reasons = [...new Set(r.skipped.map((s) => s.reason))];
      toast({
        message: [done(r), ...reasons.map((reason) => `${r.skipped.filter((s) => s.reason === reason).length}枚: ${reason}`)].join(' '),
        undo: { auditId: r.auditId, onUndone: () => void detail.reload() },
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy('publish-album');
    setError(null);
    try {
      // まとめて公開の口を使う(応答に「元に戻す」の番号がある)
      const r = await adminPost<BulkResult>('/photos/albums/publish', { albumIds: [id] });
      await detail.reload();
      if (r.changed === 0) setError(new ApiError(409, 'not_published', r.skipped[0]?.reason ?? '公開できませんでした。画面を読み込み直してください。'));
      else toast({ message: 'アルバムを公開しました。お客さんに見えるようになりました。', undo: { auditId: r.auditId, doneMessage: '公開を取り消しました。', onUndone: () => void detail.reload() } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const ids = chosen.map((p) => p.photoId);
  const draftCount = album?.counts.draft ?? 0;
  const canPublish = !!album && album.status !== 'ended' && draftCount > 0;

  return (
    <PhotoSalesFrame
      title={album?.name ?? 'アルバムの編集'}
      howto="写真を押して選び(Shift キーで範囲)、価格を変えたり、非公開にしたりできます。「公開する」でお客さんに見えるようになります。"
      aside={
        !readOnly &&
        album && (
          <>
            <Link className="btn sub" to={`/photos/upload?album=${id}`}>
              写真を足す
            </Link>
            <button type="button" className="btn" disabled={!canPublish || busy !== null} onClick={() => void publish()}>
              <BusyLabel busy={busy === 'publish-album'} pending="公開しています…">
                {album.status === 'published' && draftCount > 0 ? `まだの写真${draftCount}枚を公開する` : '公開する'}
              </BusyLabel>
            </button>
          </>
        )
      }
    >
      <Link to="/photos/albums" className="pa-back">
        ‹ アルバムの一覧
      </Link>
      {detail.error ? <ErrorNotice error={detail.error} onRetry={detail.reload} /> : null}
      {error && !dialog ? <ErrorNotice error={error} /> : null}
      {!album && !detail.error && <EditSkeleton />}
      {album && detail.data && <AlbumForm key={`${album.id}:${album.saleEndsAt}:${album.priceListId}:${album.name}`} detail={detail.data} readOnly={readOnly} onSaved={() => void detail.reload()} />}

      {album && (
        <section className="panel" aria-labelledby="pa-photos">
          <div className="pa-section-head pa-photos-head">
            <h2 id="pa-photos">写真({photos.length}枚)</h2>
            <div className="segment pa-filter" role="tablist" aria-label="写真の状態">
              {FILTERS.map((f) => (
                <button key={f.value} type="button" role="tab" aria-selected={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {!readOnly && photos.length > 0 && (
            <div className="pa-bulkbar" role="toolbar" aria-label="選んだ写真の操作">
              <span className="pa-bulk-count" role="status">
                {chosen.length ? `${chosen.length}枚を選んでいます` : '写真を押して選んでください'}
              </span>
              <button type="button" className="btn ghost" onClick={() => setSelected(chosen.length === shown.length && shown.length > 0 ? new Set() : new Set(shown.map((p) => p.photoId)))}>
                {chosen.length === shown.length && shown.length > 0 ? '選ぶのをやめる' : '表示中をすべて選ぶ'}
              </button>
              <span className="pa-bulk-acts">
                <button type="button" className="btn sub" disabled={!ids.length || !!busy} onClick={() => setDialog('price')}>
                  価格を変える
                </button>
                <button type="button" className="btn sub" disabled={!ids.length || !!busy} onClick={() => void bulk({ action: 'reset_price', photoIds: ids }, (r) => `${r.changed}枚を価格表の価格に戻しました。`)}>
                  <BusyLabel busy={busy === 'reset_price'} pending="戻しています…">
                    価格表の価格に戻す
                  </BusyLabel>
                </button>
                <button type="button" className="btn sub" disabled={!ids.length || !!busy} onClick={() => void bulk({ action: 'publish', photoIds: ids }, (r) => `${r.changed}枚を公開にしました。${album.status === 'draft' ? 'アルバムを公開すると、お客さんに見えます。' : ''}`)}>
                  <BusyLabel busy={busy === 'publish'} pending="変えています…">
                    公開にする
                  </BusyLabel>
                </button>
                <button type="button" className="btn sub" disabled={!ids.length || !!busy} onClick={() => void bulk({ action: 'hide', photoIds: ids }, (r) => `${r.changed}枚を非公開にしました。お客さんには見えません。`)}>
                  <BusyLabel busy={busy === 'hide'} pending="変えています…">
                    非公開にする
                  </BusyLabel>
                </button>
                <button type="button" className="btn sub" disabled={!ids.length || !!busy} onClick={() => setDialog('move')}>
                  ほかのアルバムへ
                </button>
                <button type="button" className="btn ghost danger-text" disabled={!ids.length || !!busy} onClick={() => setDialog('remove')}>
                  アルバムから外す
                </button>
              </span>
            </div>
          )}
          {photos.length === 0 ? (
            <div className="empty">
              <p>まだ写真がありません。写真の入ったフォルダを、アップロードの画面で落としてください。</p>
              {!readOnly && (
                <Link className="btn sub pa-empty-act" to={`/photos/upload?album=${id}`}>
                  写真を足す
                </Link>
              )}
            </div>
          ) : shown.length === 0 ? (
            <p className="empty">この状態の写真はありません。</p>
          ) : (
            <div className="pa-grid">
              <AdminPhotoGrid items={shown.map((p) => ({ id: p.photoId, url: p.thumbUrl, label: photoLabel(p), selected: selected.has(p.photoId) }))} onToggle={toggle} />
            </div>
          )}
        </section>
      )}

      {album && !readOnly && (
        <div className="pa-foot">
          <button type="button" className="btn ghost danger-text" onClick={() => setDialog('removeAlbum')}>
            このアルバムを一覧から外す
          </button>
        </div>
      )}

      {dialog === 'price' && (
        <PriceDialog
          count={ids.length}
          busy={busy === 'set_price'}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(price) => void bulk({ action: 'set_price', photoIds: ids, price }, (r) => `${r.changed}枚の価格を${formatPhotoPrice(price)}にしました。`)}
        />
      )}
      {dialog === 'move' && album && (
        <MoveDialog
          albumId={id}
          count={ids.length}
          busy={busy === 'move' || busy === 'copy'}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(action, targetAlbumId, name) =>
            void bulk({ action, photoIds: ids, targetAlbumId }, (r) => `${r.changed}枚を「${name}」へ${action === 'move' ? '移しました' : 'コピーしました'}。移した先では下書きです。`)
          }
        />
      )}
      {dialog === 'remove' && (
        <Dialog
          title="アルバムから外す"
          onClose={() => !busy && setDialog(null)}
          footer={
            <>
              <button type="button" className="btn sub" data-autofocus disabled={!!busy} onClick={() => setDialog(null)}>
                やめる
              </button>
              <button type="button" className="btn danger-fill" disabled={!!busy} onClick={() => void bulk({ action: 'remove', photoIds: ids }, (r) => `${r.changed}枚をアルバムから外しました。`)}>
                <BusyLabel busy={busy === 'remove'} pending="外しています…">
                  外す
                </BusyLabel>
              </button>
            </>
          }
        >
          <p>選んだ{ids.length}枚を、このアルバムから外します。</p>
          <ul className="plain-list">
            <li>お客さんには見えなくなります</li>
            <li>購入された写真は外せないので、非公開にします(買った人は、これまでどおりダウンロードできます)</li>
            <li>あとから「元に戻す」で戻せます</li>
          </ul>
          {error ? <ErrorNotice error={error} /> : null}
        </Dialog>
      )}
      {dialog === 'removeAlbum' && album && (
        <RemoveAlbumDialog
          albumId={id}
          name={album.name}
          onClose={() => setDialog(null)}
          onDone={() => {
            toast(`アルバム「${album.name}」を一覧から外しました。戻すときは、操作ログの画面から「元に戻す」を押してください。`);
            navigate('/photos/albums');
          }}
        />
      )}
    </PhotoSalesFrame>
  );
}

function photoLabel(p: AdminAlbumPhoto): string {
  const parts = [p.filename, formatPhotoPrice(p.price) + (p.priceOverride != null ? '(個別)' : ''), ALBUM_PHOTO_STATUS_LABELS[p.status]];
  if (p.sold) parts.push('売れた');
  if (p.alsoIn.length) parts.push(`ほかに${p.alsoIn.length}冊`);
  return parts.join(' · ');
}

function EditSkeleton() {
  return (
    <section className="panel pa-section" aria-hidden="true">
      <div className="pa-form-grid">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="field">
            <Skeleton w={72} h={13} r={4} />
            <Skeleton h={44} r={8} />
          </span>
        ))}
      </div>
    </section>
  );
}

function AlbumForm({ detail, readOnly, onSaved }: { detail: AdminAlbumDetail; readOnly: boolean; onSaved: () => void }) {
  const a = detail.album;
  const toast = useToast();
  const lists = useLoad(() => adminApi<PriceListsResponse>('/photos/price-lists'), []);
  const [name, setName] = useState(a.name);
  const [kind, setKind] = useState<AlbumKind>(a.kind);
  const [eventDate, setEventDate] = useState(a.eventDate);
  const [priceListId, setPriceListId] = useState(a.priceListId);
  const [saleEnd, setSaleEnd] = useState(a.saleEndsAt?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nameId = useId();
  const dateId = useId();
  const plId = useId();
  const endId = useId();
  const patch: Record<string, unknown> = {};
  if (name.trim() !== a.name) patch.name = name.trim();
  if (kind !== a.kind) patch.kind = kind;
  if (eventDate !== a.eventDate) patch.eventDate = eventDate;
  if (priceListId !== a.priceListId) patch.priceListId = priceListId;
  if (a.saleEndsAt && saleEnd && saleEnd !== a.saleEndsAt.slice(0, 10)) patch.saleEndsAt = endOfDayIso(saleEnd);
  const dirty = Object.keys(patch).length > 0;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPatch<AdminAlbumDetail>(`/photos/albums/${a.id}`, patch);
      toast(patch.priceListId ? 'アルバムを保存しました。写真の価格は、新しい価格表の価格になりました。' : 'アルバムを保存しました。');
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const options = (lists.data?.priceLists ?? []).filter((p) => p.status === 'active' || p.id === a.priceListId);
  const total = a.counts.draft + a.counts.published + a.counts.hidden;
  return (
    <section className="panel pa-section" aria-labelledby="pa-album-form">
      <div className="pa-section-head">
        <h2 id="pa-album-form" className="pa-row-title">
          アルバムの内容 <span className={`badge${a.status === 'published' ? ' info' : ''}`}>{ALBUM_STATUS_LABELS[a.status]}</span>
        </h2>
        <p className="sub-text pa-nums">
          {ALBUM_KIND_LABELS[a.kind]} · 写真 {total}枚(公開中 {a.counts.published}・下書き {a.counts.draft}・非公開 {a.counts.hidden})· 売上 {formatPhotoPrice(a.salesYen)}(売れた写真 {a.soldPhotos}枚)
          {a.publishedAt && <> · {formatJstDay(a.publishedAt)}に公開</>}
          {a.sourceFolder && <> · もとのフォルダ「{a.sourceFolder}」</>}
        </p>
      </div>
      <div className="pa-form-grid">
        <div className="field">
          <label htmlFor={nameId}>名前</label>
          <input id={nameId} value={name} maxLength={60} disabled={readOnly} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <RadioSegment
          label="種類"
          disabled={readOnly}
          options={[
            { value: 'date', label: '日付' },
            { value: 'event', label: 'イベント' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <div className="field">
          <label htmlFor={dateId}>開催日</label>
          <input id={dateId} type="date" value={eventDate} disabled={readOnly} onChange={(e) => setEventDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={plId}>価格表</label>
          <select id={plId} value={priceListId} disabled={readOnly} onChange={(e) => setPriceListId(Number(e.target.value))}>
            {options.length === 0 && <option value={a.priceListId}>{a.priceListName}</option>}
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}(1枚 {formatPhotoPrice(p.unitPrice)}
                {p.albumPrice != null ? `・まるごと ${formatPhotoPrice(p.albumPrice)}` : ''})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={endId}>販売終了の日</label>
          {a.saleEndsAt ? (
            <input id={endId} type="date" value={saleEnd} disabled={readOnly || !!a.filesDeletedAt} onChange={(e) => setSaleEnd(e.target.value)} />
          ) : (
            <input id={endId} value="公開すると決まります" disabled readOnly />
          )}
          <span className="hint">
            {a.saleEndsAt
              ? a.filesDeletedAt
                ? '販売期間が終わり、売れなかった写真のファイルは消えています。'
                : `${formatJstDay(a.saleEndsAt)}の終わりまで販売します。延ばすときは、日にちを変えて保存してください。`
              : '公開した日から、販売期間の設定(はじめは6か月)のあいだ販売します。'}
          </span>
        </div>
      </div>
      {!readOnly && (
        <div className="pa-section-foot">
          {error ? <ErrorNotice error={error} /> : <span className="sub-text">{dirty ? 'まだ保存していない変更があります。' : ''}</span>}
          <button type="button" className="btn sub" disabled={!dirty || busy || !name.trim()} onClick={() => void save()}>
            <BusyLabel busy={busy} pending="保存しています…">
              保存する
            </BusyLabel>
          </button>
        </div>
      )}
      {a.status === 'ended' && <p className="pa-section-note sub-text">このアルバムは販売期間が終わりました。お客さんの一覧には出ません(買った人の「購入した写真」には残ります)。</p>}
      {detail.album.eventDate !== eventDate && kind === 'date' && <p className="pa-section-note sub-text">日付のアルバムの名前は、開催日に合わせて直してください(例: {formatAlbumDate(eventDate)})。</p>}
    </section>
  );
}

const toYen = (s: string): number | null => {
  const n = Number(s.replace(/[,，円\s]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? null : Math.round(n);
};

function PriceDialog({ count, busy, error, onClose, onSubmit }: { count: number; busy: boolean; error: unknown; onClose: () => void; onSubmit: (price: number) => void }) {
  const [value, setValue] = useState('');
  const inputId = useId();
  const price = toYen(value);
  return (
    <Dialog
      title="価格を変える"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || price === null} onClick={() => price !== null && onSubmit(price)}>
            <BusyLabel busy={busy} pending="変えています…">
              この価格にする
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>選んだ{count}枚の価格を、この写真だけの価格にします。価格表を変えても、この価格のままです。</p>
      <div className="field">
        <label htmlFor={inputId}>1枚の価格(円・税込み)</label>
        <input id={inputId} inputMode="numeric" value={value} autoComplete="off" onChange={(e) => setValue(e.target.value)} />
        <span className="hint">50円以上。価格表の価格に戻すときは「価格表の価格に戻す」を押してください。</span>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

function MoveDialog({
  albumId,
  count,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  albumId: number;
  count: number;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (action: 'move' | 'copy', targetAlbumId: number, name: string) => void;
}) {
  const albums = useLoad(() => adminApi<AdminAlbumsResponse>('/photos/albums'), []);
  const [action, setAction] = useState<'move' | 'copy'>('move');
  const [target, setTarget] = useState<number | ''>('');
  const selectId = useId();
  const options = (albums.data?.albums ?? []).filter((a) => a.id !== albumId && a.status !== 'ended');
  const name = options.find((a) => a.id === target)?.name ?? '';
  return (
    <Dialog
      title="ほかのアルバムへ"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || !target} onClick={() => target && onSubmit(action, target, name)}>
            <BusyLabel busy={busy} pending={action === 'move' ? '移しています…' : 'コピーしています…'}>
              {action === 'move' ? '移す' : 'コピーする'}
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>選んだ{count}枚を、ほかのアルバムに入れます。写真のファイルは1つのまま、両方のアルバムで使います。</p>
      <RadioSegment
        label="入れ方"
        options={[
          { value: 'move', label: '移す' },
          { value: 'copy', label: 'コピー' },
        ]}
        value={action}
        onChange={setAction}
      />
      <p className="sub-text">{action === 'move' ? 'このアルバムからは外れます。購入された写真は移せません(コピーはできます)。' : 'このアルバムにも残ります。'}</p>
      <div className="field">
        <label htmlFor={selectId}>入れる先のアルバム</label>
        <select id={selectId} value={target} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : '')}>
          <option value="">選んでください</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}({ALBUM_KIND_LABELS[a.kind]}・{formatAlbumDate(a.eventDate)}・{ALBUM_STATUS_LABELS[a.status]})
            </option>
          ))}
        </select>
        <span className="hint">入れた先では下書きになります。入れた先のアルバムの価格表の価格になります。</span>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

function RemoveAlbumDialog({ albumId, name, onClose, onDone }: { albumId: number; name: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPost(`/photos/albums/${albumId}/remove`);
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="アルバムを一覧から外す"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy} onClick={() => void submit()}>
            <BusyLabel busy={busy} pending="外しています…">
              外す
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        <b>{name}</b>を、アルバムの一覧とお客さんの画面から外します。
      </p>
      <ul className="plain-list">
        <li>写真が売れているアルバムは外せません(写真を非公開にしてください)</li>
        <li>操作ログの画面の「元に戻す」で、いつでも戻せます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
