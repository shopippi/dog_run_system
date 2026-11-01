import { formatPhotoPrice, type PriceList, type PriceListsResponse } from '@dr/shared';
import { useEffect, useId, useState } from 'react';
import { BusyLabel } from '../../components/BusyLabel';
import { Dialog } from '../../components/Dialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useLoad } from '../../hooks/useLoad';
import { adminApi, adminPatch, adminPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { PhotoSalesFrame } from './PhotoSalesFrame';
import './photo-admin.css';

// PA-5 価格表(段階1-A。PF-3)。価格表を作る・変える・使わなくする、種類ごとの既定。
// 価格は保存しないので、価格表を変えると、使っているアルバムの価格がすぐ変わる(お支払い済みの注文は変わらない)。
// 元に戻すのは操作ログの画面から(価格表の変更は registerUndo に登録してある)。

export function PhotoPriceListsPage() {
  const { readOnly } = useAuth();
  const toast = useToast();
  const lists = useLoad(() => adminApi<PriceListsResponse>('/photos/price-lists'), []);
  const [editing, setEditing] = useState<PriceList | 'new' | null>(null);
  const data = lists.data?.priceLists;

  return (
    <PhotoSalesFrame
      title="価格表"
      howto="1枚の価格と、アルバムまるごとの価格を決めます。変えると、その価格表を使うアルバムにすぐ反映します。お支払い済みの注文の金額は変わりません。"
      aside={
        !readOnly && (
          <button type="button" className="btn" onClick={() => setEditing('new')}>
            価格表を作る
          </button>
        )
      }
    >
      {lists.error ? <ErrorNotice error={lists.error} onRetry={lists.reload} /> : null}
      {data && <Defaults lists={data} readOnly={readOnly} onSaved={(r) => { lists.reload(); toast(r); }} />}
      <section className="panel list-panel" aria-label="価格表の一覧">
        {!data && !lists.error ? (
          <ul className="pa-rows" aria-hidden="true">
            {[0, 1].map((i) => (
              <li key={i} className="pa-row">
                <span className="pa-row-body">
                  <Skeleton w={120} h={15} r={4} />
                  <Skeleton w={260} h={13} r={4} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="pa-rows">
            {data?.map((p) => (
              <li key={p.id} className={`pa-row${p.status === 'archived' ? ' off' : ''}`} aria-label={p.name}>
                <span className="pa-row-body">
                  <span className="pa-row-title">
                    <b>{p.name}</b>
                    {p.isDefaultFor && <span className="badge info">{p.isDefaultFor === 'date' ? '日付のアルバムの既定' : 'イベントのアルバムの既定'}</span>}
                    {p.status === 'archived' && <span className="badge">使わない</span>}
                  </span>
                  <span className="sub-text pa-nums">
                    1枚 {formatPhotoPrice(p.unitPrice)} · アルバムまるごと {p.albumPrice == null ? 'なし(まるごとでは買えません)' : formatPhotoPrice(p.albumPrice)} · 使っているアルバム {p.albumCount}冊
                  </span>
                </span>
                {!readOnly && (
                  <button type="button" className="btn ghost" aria-label={`「${p.name}」を変える`} onClick={() => setEditing(p)}>
                    変える
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="note">価格は税込みです。カード払いの決まりで、1枚・まるごとのどちらも50円以上にしてください。</p>
      {editing && (
        <PriceListDialog
          list={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null);
            toast(msg);
            void lists.reload();
          }}
        />
      )}
    </PhotoSalesFrame>
  );
}

function Defaults({ lists, readOnly, onSaved }: { lists: PriceList[]; readOnly: boolean; onSaved: (msg: string) => void }) {
  const current = { date: lists.find((p) => p.isDefaultFor === 'date')?.id ?? 0, event: lists.find((p) => p.isDefaultFor === 'event')?.id ?? 0 };
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dateId = useId();
  const eventId = useId();
  useEffect(() => setValue(current), [current.date, current.event]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = lists.filter((p) => p.status === 'active');
  const dirty = value.date !== current.date || value.event !== current.event;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi<PriceListsResponse>('/photos/price-lists/defaults', { method: 'PUT', body: JSON.stringify(value) });
      onSaved('種類ごとの既定を保存しました。これから作るアルバムに付きます。');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel pa-section" aria-labelledby="pa-defaults">
      <div className="pa-section-head">
        <h2 id="pa-defaults">種類ごとの既定</h2>
        <p className="sub-text">新しいアルバムに、はじめに付く価格表です。いまあるアルバムの価格表は変わりません。</p>
      </div>
      <div className="pa-defaults">
        <div className="field">
          <label htmlFor={dateId}>日付のアルバム</label>
          <select id={dateId} value={value.date} disabled={readOnly} onChange={(e) => setValue({ ...value, date: Number(e.target.value) })}>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}(1枚 {formatPhotoPrice(p.unitPrice)})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={eventId}>イベントのアルバム</label>
          <select id={eventId} value={value.event} disabled={readOnly} onChange={(e) => setValue({ ...value, event: Number(e.target.value) })}>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}(1枚 {formatPhotoPrice(p.unitPrice)})
              </option>
            ))}
          </select>
        </div>
        {!readOnly && (
          <button type="button" className="btn sub pa-defaults-save" disabled={!dirty || busy} onClick={() => void save()}>
            <BusyLabel busy={busy} pending="保存しています…">
              既定を保存する
            </BusyLabel>
          </button>
        )}
      </div>
      {error ? (
        <div className="pa-section-foot">
          <ErrorNotice error={error} />
        </div>
      ) : null}
    </section>
  );
}

const toYen = (s: string): number | null => {
  const n = Number(s.replace(/[,，円\s]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? null : Math.round(n);
};

function PriceListDialog({ list, onClose, onDone }: { list: PriceList | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState(list?.name ?? '');
  const [unit, setUnit] = useState(list ? String(list.unitPrice) : '');
  const [album, setAlbum] = useState(list?.albumPrice != null ? String(list.albumPrice) : '');
  const [archived, setArchived] = useState(list?.status === 'archived');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nameId = useId();
  const unitId = useId();
  const albumId = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), unitPrice: toYen(unit) ?? Number.NaN, albumPrice: toYen(album) };
    try {
      if (list) {
        await adminPatch(`/photos/price-lists/${list.id}`, { ...body, status: archived ? 'archived' : 'active' });
        onDone(list.albumCount > 0 ? `「${body.name}」を保存しました。使っている${list.albumCount}冊のアルバムの価格に、すぐ反映しました。` : `「${body.name}」を保存しました。`);
      } else {
        await adminPost('/photos/price-lists', body);
        onDone(`価格表「${body.name}」を作りました。`);
      }
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={list ? '価格表を変える' : '価格表を作る'}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || !name.trim() || toYen(unit) === null} onClick={() => void submit()}>
            <BusyLabel busy={busy} pending="保存しています…">
              {list ? '保存する' : '作る'}
            </BusyLabel>
          </button>
        </>
      }
    >
      <div className="pa-form">
        <div className="field">
          <label htmlFor={nameId}>名前</label>
          <input id={nameId} value={name} maxLength={30} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={unitId}>1枚の価格(円)</label>
          <input id={unitId} inputMode="numeric" value={unit} autoComplete="off" onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={albumId}>アルバムまるごとの価格(円)</label>
          <input id={albumId} inputMode="numeric" value={album} autoComplete="off" onChange={(e) => setAlbum(e.target.value)} />
          <span className="hint">空にすると、まるごとでは買えません。</span>
        </div>
        {list && !list.isDefaultFor && (
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            使わない(新しいアルバムでは選べなくなります。使っているアルバムはそのままです)
          </label>
        )}
        {list && list.albumCount > 0 && <p className="sub-text">この価格表は{list.albumCount}冊のアルバムで使っています。保存すると、すぐに新しい価格になります。</p>}
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
