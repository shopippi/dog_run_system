import { DOG_SIZE_LABELS, DOG_SIZES, type AdminBreed, type AdminBreedsResponse, type DogSize } from '@dr/shared';
import { useId, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { BusyLabel } from '../components/BusyLabel';
import { PageHead } from '../components/PageHead';
import { useToast } from '../components/Toast';
import { CfgListSkeleton, RadioSegment, SkeletonField, useLoaded } from '../components/SettingsKit';
import { Skeleton } from '../components/Skeleton';
import { adminApi, adminPatch, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

const SIZE_OPTIONS = DOG_SIZES.map((s) => ({ value: s, label: DOG_SIZE_LABELS[s] }));

/**
 * M-12 犬種の選択肢(A-11)。追加・名前とサイズの変更・表示/非表示・並べ替え。
 * 削除はしない(非表示にする)。非表示にしても、登録済みのワンちゃんの犬種はそのまま表示される。
 */
export function BreedsPage() {
  const { data, setData, error, reload } = useLoaded(() => adminApi<AdminBreedsResponse>('/breeds'));
  const { readOnly } = useAuth();
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AdminBreed | null>(null);
  const toast = useToast();
  const setNotice = (m: string) => toast(m);

  const run = async (fn: () => Promise<AdminBreedsResponse>, message: string) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await fn());
      setNotice(message);
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  const breeds = data?.breeds ?? [];
  const movable = breeds.filter((b) => !b.isOther);
  const move = (b: AdminBreed, dir: -1 | 1) => {
    const ids = movable.map((x) => x.id);
    const i = ids.indexOf(b.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => adminPost<AdminBreedsResponse>('/breeds/order', { ids }), `「${b.name}」を${dir < 0 ? '上' : '下'}へ動かしました。`);
  };

  return (
    <div className="page cfg-page">
      <PageHead
        title="犬種の選択肢"
        howto="お客さんがワンちゃんを登録するときに選ぶ犬種です。上にあるほど選びやすくなるので、来場の多い犬種を上に並べてください。使わなくなった犬種は「非表示」にします(登録済みのワンちゃんの犬種はそのまま残ります)。"
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!readOnly && data && <AddBreed onAdded={(r, name) => { setData(r); setNotice(`「${name}」を追加しました。`); }} />}
      {data && (
        <section className="panel list-panel" aria-label="犬種の一覧">
          {actionError ? (
            <div className="cfg-list-msg">
              <ErrorNotice error={actionError} />
            </div>
          ) : null}
          <ul className="cfg-list" aria-label="犬種">
            {breeds.map((b) => {
              const idx = movable.findIndex((x) => x.id === b.id);
              return (
                <li key={b.id} className={`cfg-item${b.visible ? '' : ' cfg-off'}`} aria-label={b.name}>
                  <span className="cfg-item-no mono">{b.isOther ? '' : idx + 1}</span>
                  <span className="cfg-item-body">
                    <b>{b.name}</b>
                    <span className="sub-text">
                      標準のサイズ {DOG_SIZE_LABELS[b.defaultSize]}
                      <span aria-hidden="true"> · </span>
                      登録 {b.dogCount}頭
                    </span>
                  </span>
                  <span className="badges">
                    {!b.visible && <span className="badge">非表示</span>}
                    {b.isOther && <span className="badge">いつも最後(自由入力)</span>}
                  </span>
                  {!readOnly && (
                    <span className="cfg-item-acts">
                      {!b.isOther && (
                        <>
                          <button type="button" className="btn ghost" aria-label={`${b.name}を上へ`} disabled={busy || idx === 0} onClick={() => move(b, -1)}>
                            上へ
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            aria-label={`${b.name}を下へ`}
                            disabled={busy || idx === movable.length - 1}
                            onClick={() => move(b, 1)}
                          >
                            下へ
                          </button>
                        </>
                      )}
                      <button type="button" className="btn ghost" aria-label={`${b.name}を変える`} disabled={busy} onClick={() => setEditing(b)}>
                        変える
                      </button>
                      {!b.isOther && (
                        <button
                          type="button"
                          className="btn ghost"
                          aria-label={`${b.name}を${b.visible ? '非表示にする' : '表示する'}`}
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => adminPatch<AdminBreedsResponse>(`/breeds/${b.id}`, { visible: !b.visible }),
                              `「${b.name}」を${b.visible ? '非表示にしました' : '表示に戻しました'}。`,
                            )
                          }
                        >
                          {b.visible ? '非表示にする' : '表示する'}
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {!data && !error && (
        <CfgListSkeleton
          rows={8}
          add={
            readOnly ? undefined : (
              <div className="cfg-add-row">
                <SkeletonField w="min(420px, 100%)" label={136} />
                <SkeletonField w={360} h="var(--control-h)" label={80} />
                <Skeleton w={96} h="var(--control-h)" r={8} />
              </div>
            )
          }
        />
      )}
      {editing && (
        <EditBreed
          breed={editing}
          onClose={() => setEditing(null)}
          onDone={(r) => {
            setData(r);
            setNotice('犬種を変えました。');
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AddBreed({ onAdded }: { onAdded: (r: AdminBreedsResponse, name: string) => void }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState<DogSize>('small');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<AdminBreedsResponse & { id: number }>('/breeds', { name, defaultSize: size });
      onAdded(r, name.trim());
      setName('');
      setSize('small');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel cfg-add" aria-label="犬種を追加">
      <form
        className="cfg-add-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor={id}>追加する犬種の名前</label>
          <input id={id} className="cfg-wide" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        </div>
        <RadioSegment label="標準のサイズ" options={SIZE_OPTIONS} value={size} onChange={setSize} />
        <button type="submit" className="btn" disabled={busy || !name.trim()}>
          <BusyLabel busy={busy} pending="追加しています…">
            追加する
          </BusyLabel>
        </button>
      </form>
      {error ? <ErrorNotice error={error} /> : null}
    </section>
  );
}

function EditBreed({ breed, onClose, onDone }: { breed: AdminBreed; onClose: () => void; onDone: (r: AdminBreedsResponse) => void }) {
  const [name, setName] = useState(breed.name);
  const [size, setSize] = useState<DogSize>(breed.defaultSize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = useId();
  const changed = name.trim() !== breed.name || size !== breed.defaultSize;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await adminPatch<AdminBreedsResponse>(`/breeds/${breed.id}`, { name, defaultSize: size }));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="犬種を変える"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || !changed || !name.trim()} onClick={submit}>
            <BusyLabel busy={busy} pending="保存しています…">
              保存する
            </BusyLabel>
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor={id}>犬種の名前</label>
        <input id={id} value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <span className="hint">名前を変えると、この犬種で登録済みのワンちゃんの表示も変わります。</span>
      </div>
      <RadioSegment label="標準のサイズ" options={SIZE_OPTIONS} value={size} onChange={setSize} />
      <p className="sub-text">標準のサイズは、お客さんが犬種を選んだときに最初に選ばれるサイズです。登録済みのワンちゃんのサイズは変わりません。</p>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
