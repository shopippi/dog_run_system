import {
  DOG_NAME_MAX,
  DOG_SEX_LABELS,
  DOG_SEXES,
  DOG_SIZE_LABELS,
  DOG_SIZES,
  DOG_STATUS_LABELS,
  type AdminDogDetail,
  type AdminDogPatch,
  type DogSex,
  type DogSize,
} from '@dr/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { useLoad } from '../hooks/useLoad';
import { ApiError, adminApi, adminPatch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { loadCurrentPhoto, loadImage, renderPhoto, uploadAdminDogPhoto, type RenderedPhoto, type Rotation } from '../lib/dog-photo';
import { formatDateTime } from '../lib/jst-format';

type Form = {
  name: string;
  breedId: number;
  breedOther: string;
  size: DogSize;
  sex: DogSex | null;
  birthYm: string;
  reason: string;
};

/** 写真の変更(保存するまで画面の中だけ) */
type PhotoDraft =
  | { kind: 'replace' | 'rotate'; source: ImageBitmap | HTMLImageElement; rotation: Rotation; rendered: RenderedPhoto | null }
  | { kind: 'remove' };

const formOf = (d: AdminDogDetail): Form => ({
  name: d.dog.name,
  breedId: d.dog.breedId,
  breedOther: d.dog.breedOther ?? '',
  size: d.dog.size,
  sex: d.dog.sex,
  birthYm: d.dog.birthYm ?? '',
  reason: '',
});

/**
 * M-07 犬の編集(A-04)。写真の差し替え・回転・削除と、名前・犬種・サイズ・性別・生まれた年月。
 * 犬種とサイズを変えるときは理由を書いてもらい、履歴に残す(6.1)。保存するとお客さんの会員証にもすぐ反映される。
 */
export function DogEditPage() {
  const { id } = useParams();
  const { readOnly } = useAuth();
  const { data, error, reload } = useLoad(() => adminApi<AdminDogDetail>(`/dogs/${id}`), [id]);
  const [notice, setNotice] = useState<ReactNode>(null);
  return (
    <div className="page">
      {data && (
        <div className="hh-back">
          <Link to={`/households/${data.household.id}`} className="btn ghost">
            <Icon name="chevron-left" />
            {data.household.displayName}に戻る
          </Link>
        </div>
      )}
      <PageHead
        title="ワンちゃんの情報の変更"
        howto="写真と登録の内容を変えて「保存する」を押してください。お客さんの会員証と今日の来場に、すぐ反映されます。犬種とサイズを変えるときは、理由を入れてください(履歴に残ります)。"
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {notice ? (
        <div className="alert info" role="status">
          {notice}
        </div>
      ) : null}
      {!data ? (
        error ? null : <p className="loading">読み込んでいます…</p>
      ) : (
        <Editor
          key={`${data.dog.id}-${data.changes[0]?.id ?? 0}-${data.dog.photoUrl ?? ''}-${data.dog.status}`}
          d={data}
          canEdit={!readOnly && data.dog.status !== 'merged' && data.household.status === 'active'}
          onSaved={(message) => {
            setNotice(message);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function Editor({ d, canEdit, onSaved }: { d: AdminDogDetail; canEdit: boolean; onSaved: (message: ReactNode) => void }) {
  const [form, setForm] = useState<Form>(() => formOf(d));
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retireOpen, setRetireOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const initial = formOf(d);
  const breed = d.breeds.find((b) => b.id === form.breedId);

  const patch: AdminDogPatch = {};
  if (form.name.trim() !== initial.name) patch.name = form.name.trim();
  if (form.breedId !== initial.breedId || (breed?.isOther && form.breedOther.trim() !== initial.breedOther)) {
    patch.breedId = form.breedId;
    patch.breedOther = breed?.isOther ? form.breedOther.trim() : null;
  }
  if (form.size !== initial.size) patch.size = form.size;
  if (form.sex !== initial.sex) patch.sex = form.sex;
  if (form.birthYm !== initial.birthYm) patch.birthYm = form.birthYm || null;
  const needsReason = 'breedId' in patch || 'size' in patch;
  if (needsReason) patch.reason = form.reason.trim();
  const changed = Object.keys(patch).length > 0 || photo !== null;
  const ready = changed && form.name.trim() !== '' && (!needsReason || form.reason.trim() !== '') && (!breed?.isOther || form.breedOther.trim() !== '');

  // 写真の変更を、画面の中で回して見せる
  useEffect(() => {
    if (!photo || photo.kind === 'remove' || photo.rendered) return;
    let alive = true;
    renderPhoto(photo.source, photo.rotation)
      .then((rendered) => alive && setPhoto((p) => (p && p.kind !== 'remove' ? { ...p, rendered } : p)))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [photo]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setPhoto({ kind: 'replace', source: await loadImage(file), rotation: 0, rendered: null });
    } catch {
      setError(new ApiError(0, 'photo', 'この写真は読み込めませんでした。別の写真を選んでください。'));
    }
  };
  const rotate = async (step: 90 | 270) => {
    setError(null);
    try {
      if (photo && photo.kind !== 'remove') {
        setPhoto({ ...photo, rotation: (((photo.rotation + step) % 360) as Rotation), rendered: null });
      } else if (d.dog.photoUrl) {
        setPhoto({ kind: 'rotate', source: await loadCurrentPhoto(d.dog.photoUrl), rotation: step, rendered: null });
      }
    } catch {
      setError(new ApiError(0, 'photo', '今の写真を読み込めませんでした。画面を読み込み直してください。'));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (Object.keys(patch).length > 0) await adminPatch(`/dogs/${d.dog.id}`, patch);
      if (photo?.kind === 'remove') {
        await adminApi(`/dogs/${d.dog.id}/photo`, { method: 'DELETE' });
      } else if (photo) {
        const rendered = photo.rendered ?? (await renderPhoto(photo.source, photo.rotation));
        await uploadAdminDogPhoto(d.dog.id, rendered, photo.kind);
      }
      onSaved(
        <p>
          保存しました。お客さんの会員証と今日の来場にも反映されています。間違えたときは、<Link to="/audit">操作ログ</Link>から元に戻せます。
        </p>,
      );
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const previewUrl = photo?.kind === 'remove' ? null : photo?.rendered?.previewUrl ?? (photo ? null : d.dog.photoUrl);
  const hasPhoto = photo ? photo.kind !== 'remove' : Boolean(d.dog.photoUrl);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <section className="panel dg-photo" aria-labelledby="dg-photo-title">
        <h2 id="dg-photo-title" className="hh-section-title">
          写真
        </h2>
        <div className="dg-photo-body">
          {previewUrl ? (
            <img className="dg-photo-img" src={previewUrl} alt={`${d.dog.name}の写真`} width={176} height={176} />
          ) : photo && photo.kind !== 'remove' ? (
            <div className="dg-photo-img" aria-label="写真を準備しています" />
          ) : (
            <DogFace name={d.dog.name} breedName={d.dog.breedName} size={176} shape="square" />
          )}
          <div className="dg-photo-side">
            <p className="sub-text">
              {photo?.kind === 'remove'
                ? '保存すると、写真を外します(犬種の色と名前の頭文字の絵になります)。'
                : photo
                  ? '保存すると、この写真になります。'
                  : hasPhoto
                    ? '向きがおかしいときは、回してから保存してください。'
                    : 'まだ写真がありません。'}
            </p>
            {canEdit && (
              <div className="dg-photo-acts">
                <label className="btn sub" aria-disabled={busy || undefined}>
                  <input
                    ref={fileRef}
                    className="sr-only"
                    type="file"
                    disabled={busy}
                    accept="image/*"
                    onChange={(e) => {
                      void choose(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  写真を選ぶ
                </label>
                {hasPhoto && (
                  <>
                    <button type="button" className="btn sub" disabled={busy} onClick={() => void rotate(270)}>
                      左に回す
                    </button>
                    <button type="button" className="btn sub" disabled={busy} onClick={() => void rotate(90)}>
                      右に回す
                    </button>
                  </>
                )}
                {hasPhoto && (
                  <button type="button" className="btn ghost danger-text" disabled={busy} onClick={() => setPhoto({ kind: 'remove' })}>
                    写真を外す
                  </button>
                )}
                {photo && (
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => setPhoto(null)}>
                    写真の変更をやめる
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel dg-form" aria-labelledby="dg-form-title">
        <h2 id="dg-form-title" className="hh-section-title">
          登録の内容
          <span className="sub-text mono">{d.dog.dogNo}</span>
          {d.dog.status !== 'active' && <span className="badge">{DOG_STATUS_LABELS[d.dog.status]}</span>}
        </h2>
        <fieldset className="dg-fields" disabled={!canEdit || busy}>
          <div className="field">
            <label htmlFor="dg-name">
              名前 <span className="req">必須</span>
            </label>
            <input id="dg-name" value={form.name} maxLength={DOG_NAME_MAX} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dg-breed">
              犬種 <span className="req">必須</span>
            </label>
            <select
              id="dg-breed"
              value={form.breedId}
              onChange={(e) => {
                const b = d.breeds.find((x) => x.id === Number(e.target.value));
                setForm((f) => ({ ...f, breedId: Number(e.target.value), size: b && !b.isOther ? b.defaultSize : f.size }));
              }}
            >
              {d.breeds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          {breed?.isOther && (
            <div className="field">
              <label htmlFor="dg-breed-other">
                犬種(自由入力) <span className="req">必須</span>
              </label>
              <input id="dg-breed-other" value={form.breedOther} maxLength={30} onChange={(e) => set('breedOther', e.target.value)} />
            </div>
          )}
          <div className="field">
            <span className="label" id="dg-size">
              サイズ <span className="req">必須</span>
            </span>
            <div className="segment" role="radiogroup" aria-labelledby="dg-size">
              {DOG_SIZES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={form.size === s} onClick={() => set('size', s)}>
                  {DOG_SIZE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          {needsReason && (
            <div className="field">
              <label htmlFor="dg-reason">
                犬種・サイズを変える理由 <span className="req">必須</span>
              </label>
              <input id="dg-reason" value={form.reason} maxLength={100} placeholder="例: 登録のときの選びまちがい" onChange={(e) => set('reason', e.target.value)} />
              <span className="hint">犬種とサイズは分析に使うため、変えた理由を履歴に残します。</span>
            </div>
          )}
          <div className="field">
            <span className="label" id="dg-sex">
              性別
            </span>
            <div className="segment" role="radiogroup" aria-labelledby="dg-sex">
              {DOG_SEXES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={form.sex === s} onClick={() => set('sex', s)}>
                  {DOG_SEX_LABELS[s]}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={form.sex === null} onClick={() => set('sex', null)}>
                未登録
              </button>
            </div>
          </div>
          <div className="field dg-ym">
            <label htmlFor="dg-birth">生まれた年月</label>
            <input id="dg-birth" type="month" value={form.birthYm} min="1990-01" onChange={(e) => set('birthYm', e.target.value)} />
            <span className="hint">分からなければ空のままにしてください。</span>
          </div>
        </fieldset>
        {canEdit && (
          <div className="dg-foot">
            {error ? <ErrorNotice error={error} /> : null}
            <div className="dg-foot-row">
              <button type="button" className="btn" disabled={!ready || busy} onClick={save}>
                {busy ? '保存しています…' : '保存する'}
              </button>
              <button type="button" className="btn ghost danger-text" disabled={busy} onClick={() => setRetireOpen(true)}>
                {d.dog.status === 'active' ? '登録を解除する' : '登録解除を取り消す'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel hh-section" aria-labelledby="dg-history-title">
        <h2 id="dg-history-title" className="hh-section-title">
          変更の履歴
        </h2>
        {d.changes.length === 0 ? (
          <p className="empty">まだ変更はありません。</p>
        ) : (
          <ul className="hh-list" aria-label="変更の履歴">
            {d.changes.map((c) => (
              <li key={c.id} className="hh-row">
                <span className="hh-date mono">
                  <span>{formatDateTime(c.at).split(' ')[0]}</span>
                  <span>{formatDateTime(c.at).split(' ')[1]}</span>
                </span>
                <span className="hh-main">
                  <b>
                    {c.fieldLabel}: {c.before ?? '未登録'} → {c.after ?? (c.fieldLabel === '写真' ? '写真なし' : '未登録')}
                  </b>
                  <span className="sub-text">
                    {c.reason ? `理由: ${c.reason} · ` : ''}
                    {c.actorName}
                  </span>
                </span>
                <span className="hh-end" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {retireOpen && (
        <RetireDialog
          d={d}
          onClose={() => setRetireOpen(false)}
          onDone={(message) => {
            setRetireOpen(false);
            onSaved(message);
          }}
        />
      )}
    </>
  );
}

/** 登録解除・その取り消しの確認(6.1。過去の来場記録は残り、チェックインの選択肢に出なくなる) */
function RetireDialog({ d, onClose, onDone }: { d: AdminDogDetail; onClose: () => void; onDone: (m: ReactNode) => void }) {
  const retire = d.dog.status === 'active';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPatch(`/dogs/${d.dog.id}`, { status: retire ? 'retired' : 'active' });
      onDone(<p>{retire ? `${d.dog.name}の登録を解除しました。` : `${d.dog.name}の登録解除を取り消しました。`}間違えたときは、操作ログから元に戻せます。</p>);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={retire ? 'ワンちゃんの登録を解除する' : '登録解除を取り消す'}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className={retire ? 'btn danger-fill' : 'btn'} disabled={busy} onClick={submit}>
            {busy ? '変えています…' : retire ? '登録を解除する' : '取り消す'}
          </button>
        </>
      }
    >
      <p>
        <b>{d.dog.name}</b>({d.household.displayName}){retire ? 'の登録を解除します。' : 'を、もう一度チェックインで選べるようにします。'}
      </p>
      {retire && (
        <ul className="plain-list">
          <li>これまでの来場の記録は残ります</li>
          <li>チェックインのときに、選べなくなります</li>
        </ul>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
