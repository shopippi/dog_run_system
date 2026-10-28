import {
  DOG_NAME_MAX,
  DOG_SEXES,
  DOG_SEX_LABELS,
  DOG_SIZES,
  DOG_SIZE_LABELS,
  DOG_SOCIABILITY,
  DOG_SOCIABILITY_LABELS,
  VACCINE_YEAR_MIN,
  currentJstYear,
  dogInputSchema,
  parseWeightInput,
  type Breed,
  type DogInput,
  type DogSummary,
  type DogSex,
  type DogSize,
  type DogSociability,
} from '@dr/shared';
import { useId, useState } from 'react';
import { resizePhoto, type ResizedPhoto } from '../lib/photo';
import { ChoiceGroup } from './ChoiceGroup';
import { DogAvatar } from './DogAvatar';

export type DogDraft = {
  key: string;
  name: string;
  breedId: number | null;
  breedOther: string;
  size: DogSize | null;
  sex: DogSex | null;
  birthYear: string;
  birthMonth: string;
  /** 2026-10-28 に足した任意の項目(体重は入力中の文字、年は選んだ年の文字) */
  weight: string;
  sociability: DogSociability | null;
  rabiesYear: string;
  comboYear: string;
  photo: ResizedPhoto | null;
};

/** 登録済みの犬を、入力の形にする(C-08) */
export function dogToDraft(d: DogSummary): DogDraft {
  const [y = '', m = ''] = d.birthYm ? d.birthYm.split('-') : [];
  return {
    key: String(d.id),
    name: d.name,
    breedId: d.breedId,
    breedOther: d.breedOther ?? '',
    size: d.size,
    sex: d.sex,
    birthYear: y,
    birthMonth: m ? String(Number(m)) : '',
    weight: d.weightKg == null ? '' : d.weightKg.toFixed(1),
    sociability: d.sociability,
    rabiesYear: d.rabiesVaccineYear ? String(d.rabiesVaccineYear) : '',
    comboYear: d.comboVaccineYear ? String(d.comboVaccineYear) : '',
    photo: null,
  };
}

export function emptyDogDraft(): DogDraft {
  return {
    key: Math.random().toString(36).slice(2),
    name: '',
    breedId: null,
    breedOther: '',
    size: null,
    sex: null,
    birthYear: '',
    birthMonth: '',
    weight: '',
    sociability: null,
    rabiesYear: '',
    comboYear: '',
    photo: null,
  };
}

/** 入力を API に送る形にする。足りないところがあれば、日本語のメッセージを返す。 */
export function draftToInput(d: DogDraft): { input: DogInput } | { error: string } {
  const birthYm = d.birthYear && d.birthMonth ? `${d.birthYear}-${d.birthMonth.padStart(2, '0')}` : null;
  if ((d.birthYear && !d.birthMonth) || (!d.birthYear && d.birthMonth)) {
    return { error: '生まれた年月は、年と月の両方を選んでください(分からなければ両方とも空欄)。' };
  }
  const parsed = dogInputSchema.safeParse({
    name: d.name,
    breedId: d.breedId ?? 0,
    breedOther: d.breedOther || null,
    size: d.size ?? undefined,
    sex: d.sex,
    birthYm,
    weightKg: parseWeightInput(d.weight),
    sociability: d.sociability,
    rabiesVaccineYear: d.rabiesYear ? Number(d.rabiesYear) : null,
    comboVaccineYear: d.comboYear ? Number(d.comboYear) : null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '入力を確かめてください。' };
  return { input: parsed.data };
}

type Props = {
  draft: DogDraft;
  breeds: Breed[];
  onChange: (d: DogDraft) => void;
  /** 犬種とサイズを変えられるか(登録後は管理者だけが変えられる。6.1) */
  breedEditable?: boolean;
  title?: string;
  onRemove?: () => void;
  /** 登録済みの写真(差し替える前の写真) */
  currentPhotoUrl?: string | null;
};

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 26 }, (_, i) => String(THIS_YEAR - i));
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));
/** 予防注射の年(今年から 2000 年まで、新しい順) */
const VACCINE_YEARS = Array.from({ length: currentJstYear() - VACCINE_YEAR_MIN + 1 }, (_, i) => String(currentJstYear() - i));
const hasExtra = (d: DogDraft) => Boolean(d.weight || d.sociability || d.rabiesYear || d.comboYear);

/** 犬の登録項目の入力(6.1)。L-02 と L-09 で使う。 */
export function DogForm({ draft, breeds, onChange, breedEditable = true, title, onRemove, currentPhotoUrl }: Props) {
  const id = useId();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const set = (patch: Partial<DogDraft>) => onChange({ ...draft, ...patch });
  const breed = breeds.find((b) => b.id === draft.breedId);
  // 任意の項目の欄は、すでに入っていれば開いておく(最初の表示のときだけ決め、入力中に勝手に閉じない)
  const [extraOpen] = useState(() => hasExtra(draft));

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      set({ photo: await resizePhoto(file) });
    } catch {
      setPhotoError('この写真は読み込めませんでした。別の写真を選ぶか、カメラで撮り直してください。');
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <fieldset className="panel dog-form">
      <div className="dog-form-head">
        <legend>{title ?? 'ワンちゃん'}</legend>
        {onRemove && (
          <button type="button" className="btn ghost danger-text" onClick={onRemove}>
            この子を削除
          </button>
        )}
      </div>

      <div className="photo-pick">
        <DogAvatar
          name={draft.name || '?'}
          breedName={breed?.name ?? ''}
          previewUrl={draft.photo?.previewUrl}
          url={currentPhotoUrl}
          size={72}
        />
        <div className="photo-pick-body">
          <label className="up btn sub" htmlFor={`${id}-photo`}>
            {photoBusy ? '写真を準備しています…' : draft.photo || currentPhotoUrl ? '写真を撮り直す・選び直す' : '写真を撮る・選ぶ'}
          </label>
          <input
            id={`${id}-photo`}
            type="file"
            accept="image/*"
            onChange={(e) => {
              void pickPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {photoError ? <span className="err" role="alert">{photoError}</span> : <span className="hint">写真はあとからでも登録できます</span>}
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${id}-name`}>
          名前<span className="req">必須</span>
        </label>
        <input
          id={`${id}-name`}
          value={draft.name}
          maxLength={DOG_NAME_MAX}
          autoComplete="off"
          placeholder="例: アル"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      {breedEditable && (
        <>
          <div className="field">
            <label htmlFor={`${id}-breed`}>
              犬種<span className="req">必須</span>
            </label>
            <select
              id={`${id}-breed`}
              value={draft.breedId ?? ''}
              onChange={(e) => {
                const b = breeds.find((x) => x.id === Number(e.target.value));
                // サイズは犬種から初期値を自動で選ぶ(6.1)
                set({ breedId: b?.id ?? null, size: b ? b.defaultSize : draft.size });
              }}
            >
              <option value="">選んでください</option>
              {breeds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          {breed?.isOther && (
            <div className="field">
              <label htmlFor={`${id}-other`}>
                犬種を入力<span className="req">必須</span>
              </label>
              <input
                id={`${id}-other`}
                value={draft.breedOther}
                maxLength={30}
                placeholder="例: 甲斐犬"
                onChange={(e) => set({ breedOther: e.target.value })}
              />
            </div>
          )}
          <div className="field">
            <span className="label" id={`${id}-size`}>
              サイズ<span className="req">必須</span>
            </span>
            <ChoiceGroup
              labelledBy={`${id}-size`}
              options={DOG_SIZES.map((s) => ({ value: s, label: DOG_SIZE_LABELS[s] }))}
              value={draft.size}
              onChange={(size) => set({ size })}
            />
          </div>
        </>
      )}

      <div className="field">
        <span className="label" id={`${id}-sex`}>
          性別
        </span>
        <ChoiceGroup
          labelledBy={`${id}-sex`}
          options={DOG_SEXES.map((s) => ({ value: s, label: DOG_SEX_LABELS[s] }))}
          value={draft.sex}
          onChange={(sex) => set({ sex })}
        />
      </div>

      <div className="field">
        <span className="label">生まれた年月</span>
        <div className="row2">
          <select aria-label="生まれた年" value={draft.birthYear} onChange={(e) => set({ birthYear: e.target.value })}>
            <option value="">年</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
          <select aria-label="生まれた月" value={draft.birthMonth} onChange={(e) => set({ birthMonth: e.target.value })}>
            <option value="">月</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </div>
        <span className="hint">分からなければ空欄のままで大丈夫です</span>
      </div>

      {/* 体重・相性・予防注射は任意。たたんでおき、あとで答えてもよい(担当J) */}
      <details className="pf-more" open={extraOpen || undefined}>
        <summary>
          <span>体重・相性・予防注射</span>
          <span className="note">あとでもよい</span>
        </summary>
        <div className="pf-more-body">
          <div className="field">
            <label htmlFor={`${id}-weight`}>体重</label>
            <div className="pf-unit">
              <input
                id={`${id}-weight`}
                value={draft.weight}
                inputMode="decimal"
                maxLength={5}
                autoComplete="off"
                placeholder="例: 5.2"
                onChange={(e) => set({ weight: e.target.value })}
              />
              <span aria-hidden="true">kg</span>
            </div>
          </div>
          <div className="field">
            <span className="label" id={`${id}-soc`}>
              ほかの犬との相性
            </span>
            <ChoiceGroup
              labelledBy={`${id}-soc`}
              options={DOG_SOCIABILITY.map((s) => ({ value: s, label: DOG_SOCIABILITY_LABELS[s] }))}
              value={draft.sociability}
              onChange={(sociability) => set({ sociability })}
            />
          </div>
          <div className="row2">
            <div className="field">
              <label htmlFor={`${id}-rabies`}>狂犬病の予防注射</label>
              <select id={`${id}-rabies`} value={draft.rabiesYear} onChange={(e) => set({ rabiesYear: e.target.value })}>
                <option value="">年</option>
                {VACCINE_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-combo`}>混合ワクチン</label>
              <select id={`${id}-combo`} value={draft.comboYear} onChange={(e) => set({ comboYear: e.target.value })}>
                <option value="">年</option>
                {VACCINE_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
            </div>
          </div>
          <span className="hint">いちばん最近に受けた年です。受付での確認と、ご案内に使います。</span>
        </div>
      </details>
    </fieldset>
  );
}
