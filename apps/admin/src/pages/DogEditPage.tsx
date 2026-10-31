import {
  DOG_NAME_MAX,
  DOG_SEX_LABELS,
  DOG_SEXES,
  DOG_SIZE_LABELS,
  DOG_SIZES,
  DOG_SOCIABILITY,
  DOG_SOCIABILITY_LABELS,
  DOG_STATUS_LABELS,
  VACCINE_YEAR_MIN,
  currentJstYear,
  dogWeightSchema,
  parseWeightInput,
  type AdminDogDetail,
  type AdminDogPatch,
  type DogSex,
  type DogSize,
  type DogSociability,
} from '@dr/shared';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { BusyLabel } from '../components/BusyLabel';
import { PageHead } from '../components/PageHead';
import { Loading, Skeleton, SkeletonText } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useLoad } from '../hooks/useLoad';
import { usePhotoSrc } from '../hooks/usePhotoSrc';
import { ApiError, adminApi, adminPatch, adminPost } from '../lib/api';
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
  /** 2026-10-28 に足した任意の項目(担当J)。体重は入力中の文字、年は選んだ年の文字 */
  weight: string;
  sociability: DogSociability | null;
  rabiesYear: string;
  comboYear: string;
  reason: string;
};

/** 予防注射の年の選択肢(今年から 2000 年まで、新しい順) */
const VACCINE_YEARS = Array.from({ length: currentJstYear() - VACCINE_YEAR_MIN + 1 }, (_, i) => String(currentJstYear() - i));

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
  weight: d.dog.weightKg == null ? '' : d.dog.weightKg.toFixed(1),
  sociability: d.dog.sociability,
  rabiesYear: d.dog.rabiesVaccineYear ? String(d.dog.rabiesVaccineYear) : '',
  comboYear: d.dog.comboVaccineYear ? String(d.dog.comboVaccineYear) : '',
  reason: '',
});

/**
 * M-07 犬の編集(A-04)。写真の差し替え・回転・削除と、名前・犬種・サイズ・性別・生まれた年月・体重・相性・予防注射の年。
 * 犬種とサイズを変えるときは理由を書いてもらい、履歴に残す(6.1)。保存するとお客さんの会員証にもすぐ反映される。
 */
export function DogEditPage() {
  const { id } = useParams();
  const { readOnly, staff } = useAuth();
  const { data, error, reload } = useLoad(() => adminApi<AdminDogDetail>(`/dogs/${id}`), [id]);
  const toast = useToast();
  const current = data && String(data.dog.id) === id ? data : null;
  const loadingCrumb = <Skeleton w={120} h={12} r={4} style={{ display: 'inline-block' }} />;
  return (
    <div className="page">
      <PageHead
        title="ワンちゃんの情報の変更"
        crumbs={[
          { label: 'おうちを探す', to: '/search' },
          current ? { label: current.household.displayName, to: `/households/${current.household.id}` } : { label: loadingCrumb },
          { label: current ? current.dog.name : loadingCrumb },
        ]}
        howto="写真と登録の内容を変えて「保存する」を押してください。お客さんの会員証と今日の来場に、すぐ反映されます。犬種とサイズを変えるときは、理由を入れてください(履歴に残ります)。"
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        error ? null : <DogEditSkeleton />
      ) : (
        <Editor
          key={`${data.dog.id}-${data.changes[0]?.id ?? 0}-${data.dog.photoUrl ?? ''}-${data.dog.status}`}
          d={data}
          canEdit={!readOnly && data.dog.status !== 'merged' && data.household.status === 'active'}
          onSaved={(message) => {
            toast(message);
            void reload();
          }}
        />
      )}
      {data?.stay && <StaySection d={data} canEdit={!readOnly && staff?.role === 'admin'} onChanged={() => void reload()} />}
    </div>
  );
}

/**
 * 預かり・お泊まりの経験(21章)。紙の台帳のころに預かったことのある子は、管理者が「預かり経験あり」の印を付けると、
 * 次の予約からすぐ確定になる(はじめての子は確認待ち)。操作ログから元に戻せる。
 */
function StaySection({ d, canEdit, onChanged }: { d: AdminDogDetail; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const stay = d.stay!;
  const toggle = async (experienced: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<{ auditId: number | null }>(`/dogs/${d.dog.id}/stay-experience`, { experienced });
      toast({ message: experienced ? `${d.dog.name}を「預かり経験あり」にしました。` : `${d.dog.name}の「預かり経験あり」を外しました。`, undo: { auditId: r.auditId, onUndone: onChanged } });
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel hh-section" aria-labelledby="dg-stay-title">
      <h2 id="dg-stay-title" className="hh-section-title">
        預かり・お泊まり
      </h2>
      <div className="dg-stay">
        <p>
          {stay.stays > 0
            ? `受付でお預かりしたことがあります(${stay.stays}回)。予約はすぐ確定します。`
            : stay.marked
              ? '「預かり経験あり」の印が付いています。予約はすぐ確定します。'
              : 'まだお預かりしたことがありません。予約は、お店の確認を待ちます。'}
        </p>
        {canEdit && stay.stays === 0 && (
          <label className="check">
            <input type="checkbox" checked={stay.marked} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
            預かり経験あり(紙の台帳のころに預かったことがある)
          </label>
        )}
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    </section>
  );
}

/** 読み込み中: 写真のまとまり(176 の正方形)と、登録の内容の欄 */
function DogEditSkeleton() {
  return (
    <Loading>
      <section className="panel dg-photo">
        <div className="hh-section-title">
          <SkeletonText size={17} lh={1.35} w={40} />
        </div>
        <div className="dg-photo-body">
          <Skeleton w={176} h={176} r={12} />
          <div className="dg-photo-side">
            <SkeletonText size={13} w={260} />
            <div className="dg-photo-acts">
              <Skeleton w={104} h="var(--control-h)" r={8} />
            </div>
          </div>
        </div>
      </section>
      <section className="panel dg-form">
        <div className="hh-section-title">
          <SkeletonText size={17} lh={1.35} w={120} />
        </div>
        <div className="dg-fields">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="field">
              <SkeletonText size={13} w={[40, 40, 56, 40, 88, 64][i]} />
              <Skeleton h={44} r={8} />
            </div>
          ))}
        </div>
      </section>
    </Loading>
  );
}

function Editor({ d, canEdit, onSaved }: { d: AdminDogDetail; canEdit: boolean; onSaved: (message: string) => void }) {
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
  // 体重(小数1桁)。読めない値のときは保存できないようにして、下に理由を出す
  const weight = parseWeightInput(form.weight);
  const weightCheck = weight === null ? null : dogWeightSchema.safeParse(weight);
  const weightError = weightCheck && !weightCheck.success ? (weightCheck.error.issues[0]?.message ?? '体重を確かめてください。') : null;
  if (form.weight.trim() !== initial.weight && !weightError) patch.weightKg = weight;
  if (form.sociability !== initial.sociability) patch.sociability = form.sociability;
  if (form.rabiesYear !== initial.rabiesYear) patch.rabiesVaccineYear = form.rabiesYear ? Number(form.rabiesYear) : null;
  if (form.comboYear !== initial.comboYear) patch.comboVaccineYear = form.comboYear ? Number(form.comboYear) : null;
  const needsReason = 'breedId' in patch || 'size' in patch;
  if (needsReason) patch.reason = form.reason.trim();
  const changed = Object.keys(patch).length > 0 || photo !== null;
  const ready =
    changed &&
    !weightError &&
    form.name.trim() !== '' &&
    (!needsReason || form.reason.trim() !== '') &&
    (!breed?.isOther || form.breedOther.trim() !== '');

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
      onSaved('保存しました。お客さんの会員証と今日の来場にも反映されています。');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const previewUrl = photo?.kind === 'remove' ? null : photo?.rendered?.previewUrl ?? (photo ? null : d.dog.photoUrl);
  const previewSrc = usePhotoSrc(previewUrl);
  const hasPhoto = photo ? photo.kind !== 'remove' : Boolean(d.dog.photoUrl);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <section className="panel dg-photo" aria-labelledby="dg-photo-title">
        <h2 id="dg-photo-title" className="hh-section-title">
          写真
        </h2>
        <div className="dg-photo-body">
          {previewSrc ? (
            <img className="dg-photo-img" src={previewSrc} alt={`${d.dog.name}の写真`} width={176} height={176} />
          ) : previewUrl || (photo && photo.kind !== 'remove') ? (
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
          <div className="field">
            <label htmlFor="dg-weight">体重(kg)</label>
            <input
              id="dg-weight"
              className="dg-weight"
              value={form.weight}
              inputMode="decimal"
              maxLength={5}
              placeholder="例: 5.2"
              aria-invalid={weightError ? true : undefined}
              aria-describedby="dg-weight-hint"
              onChange={(e) => set('weight', e.target.value)}
            />
            <span id="dg-weight-hint" className={weightError ? 'err' : 'hint'}>
              {weightError ?? '小数1桁まで。分からなければ空のままにしてください。'}
            </span>
          </div>
          <div className="field">
            <span className="label" id="dg-soc">
              ほかの犬との相性
            </span>
            <div className="segment dg-soc" role="radiogroup" aria-labelledby="dg-soc">
              {DOG_SOCIABILITY.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={form.sociability === x} onClick={() => set('sociability', x)}>
                  {DOG_SOCIABILITY_LABELS[x]}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={form.sociability === null} onClick={() => set('sociability', null)}>
                未登録
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="dg-rabies">狂犬病の予防注射(最近の年)</label>
            <select id="dg-rabies" value={form.rabiesYear} onChange={(e) => set('rabiesYear', e.target.value)}>
              <option value="">未登録</option>
              {VACCINE_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dg-combo">混合ワクチン(最近の年)</label>
            <select id="dg-combo" value={form.comboYear} onChange={(e) => set('comboYear', e.target.value)}>
              <option value="">未登録</option>
              {VACCINE_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        {canEdit && (
          <div className="dg-foot">
            {error ? <ErrorNotice error={error} /> : null}
            <div className="dg-foot-row">
              <button type="button" className="btn" disabled={!ready || busy} onClick={save}>
                <BusyLabel busy={busy} pending="保存しています…">
                  保存する
                </BusyLabel>
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setRetireOpen(true)}>
                {d.dog.status === 'active' ? '登録をおやすみする' : '登録に戻す'}
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

/** 登録をおやすみする(内部の値は retired)・登録に戻す の確認(6.1。過去の来場記録は残り、チェックインの選択肢に出なくなる) */
function RetireDialog({ d, onClose, onDone }: { d: AdminDogDetail; onClose: () => void; onDone: (m: string) => void }) {
  const retire = d.dog.status === 'active';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPatch(`/dogs/${d.dog.id}`, { status: retire ? 'retired' : 'active' });
      onDone(retire ? `${d.dog.name}の登録をおやすみしました。` : `${d.dog.name}を登録に戻しました。`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={retire ? 'ワンちゃんの登録をおやすみする' : '登録に戻す'}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy} onClick={submit}>
            <BusyLabel busy={busy} pending="変えています…">
              {retire ? 'おやすみする' : '登録に戻す'}
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        <b>{d.dog.name}</b>({d.household.displayName}){retire ? 'の登録をおやすみします。' : 'を登録に戻して、もう一度チェックインで選べるようにします。'}
      </p>
      {retire && (
        <ul className="plain-list">
          <li>これまでの来場の記録は、そのまま残ります</li>
          <li>チェックインのときに、選べなくなります</li>
          <li>いつでも登録に戻せます</li>
        </ul>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
