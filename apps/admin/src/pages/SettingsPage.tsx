import {
  checkSettingsPatch,
  type ExpiryRule,
  type SettingKey,
  type Settings,
  type SettingsResponse,
} from '@dr/shared';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHead } from '../components/PageHead';
import { BusyLabel } from '../components/BusyLabel';
import { CfgSectionSkeleton, QrCode, SaveFoot, Section, useLoaded } from '../components/SettingsKit';
import { Loading } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { ApiError, adminApi, adminPatch, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { publishFacilityName } from '../hooks/useFacilityName';

type Draft = Record<string, unknown>;
type OnSaved = (r: SettingsResponse) => void;

/**
 * M-13 ルールの設定(A-12)。項目ごとにまとまりを分け、まとまりごとに保存する。
 * 変更は操作ログに残り、操作ログから元に戻せる。
 */
export function SettingsPage() {
  const { data, setData, error, reload } = useLoaded(() => adminApi<SettingsResponse>('/settings'));
  return (
    <div className="page cfg-page">
      <PageHead
        title="ルールの設定"
        howto="ポイントや無料券のルール、分析の基準などを変えられます。まとまりごとに「保存する」を押してください。変えた内容は操作ログに残り、そこから元に戻せます。"
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        !error && (
          <Loading>
            <CfgSectionSkeleton fields={1} title={88} fieldW="min(420px, 100%)" hint />
            <CfgSectionSkeleton fields={3} title={160} />
            <CfgSectionSkeleton fields={2} title={120} />
          </Loading>
        )
      ) : (
        <>
          <FacilitySection
            settings={data.settings}
            onSaved={(r) => {
              setData(r);
              publishFacilityName(r.settings.facility_name);
            }}
          />
          <PointsSection settings={data.settings} onSaved={setData} />
          <AnalysisSection settings={data.settings} onSaved={setData} />
          <InviteSection settings={data.settings} onSaved={setData} />
          <CheckinQrSection data={data} onSaved={setData} />
          <MigrationSection settings={data.settings} onSaved={setData} />
          <TermsSection settings={data.settings} onSaved={setData} />
          <ContactSection settings={data.settings} onSaved={setData} />
        </>
      )}
    </div>
  );
}

/**
 * まとまりごとの下書きと保存。数の欄は入力中は文字のまま持ち、保存するときに数にする。
 * 入力チェックは API と同じもの(checkSettingsPatch)を先に画面で行う。
 */
function useSettingsDraft(settings: Settings, keys: SettingKey[], onSaved: OnSaved) {
  const pick = (s: Settings): Draft => Object.fromEntries(keys.map((k) => [k, s[k]]));
  const base = JSON.stringify(pick(settings));
  const [draft, setDraft] = useState<Draft>(() => JSON.parse(base) as Draft);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => {
    setDraft(JSON.parse(base) as Draft);
  }, [base]);

  const toValues = (d: Draft): Draft => {
    const out: Draft = {};
    for (const k of keys) {
      const v = d[k];
      if (typeof settings[k] === 'number') {
        out[k] = typeof v === 'string' ? (v.trim() === '' ? Number.NaN : Number(v)) : v;
      } else if (k === 'point_expiry' || k === 'ticket_expiry') {
        const r = v as { mode: ExpiryRule['mode']; months?: number | string };
        out[k] = r.mode === 'none' ? { mode: 'none' } : { mode: r.mode, months: r.months === '' ? Number.NaN : Number(r.months) };
      } else {
        out[k] = v;
      }
    }
    return out;
  };
  const values = toValues(draft);
  const dirty = JSON.stringify(values) !== base;

  const set = (key: SettingKey, value: unknown) => {
    setSaved(false);
    setError(null);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const save = async () => {
    const changed = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(settings[k as SettingKey])),
    );
    const checked = checkSettingsPatch(changed);
    if (!checked.ok) {
      setError(new ApiError(400, 'bad_request', checked.message));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await adminPatch<SettingsResponse>('/settings', checked.data));
      setSaved(true);
      toast('保存しました。');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { draft, set, dirty, busy, saved, error, save };
}

function SettingsForm({
  title,
  desc,
  state,
  children,
}: {
  title: string;
  desc?: ReactNode;
  state: ReturnType<typeof useSettingsDraft>;
  children: ReactNode;
}) {
  const { readOnly } = useAuth();
  return (
    <Section
      title={title}
      desc={desc}
      foot={
        readOnly ? undefined : (
          <SaveFoot dirty={state.dirty} busy={state.busy} saved={state.saved} error={state.error} onSave={() => void state.save()} />
        )
      }
    >
      <fieldset className="cfg-fieldset" disabled={readOnly}>
        {children}
      </fieldset>
    </Section>
  );
}

/** 数を入れる欄(単位つき) */
function NumField({
  label,
  hint,
  unit,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  hint?: string;
  unit: string;
  value: unknown;
  onChange: (v: string) => void;
  min: number;
  max: number;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="cfg-num">
        <input id={id} type="number" inputMode="numeric" min={min} max={max} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        <span className="sub-text">{unit}</span>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

const EXPIRY_MODES: { mode: ExpiryRule['mode']; label: string }[] = [
  { mode: 'none', label: '期限なし' },
  { mode: 'months_from_grant', label: 'もらった日から' },
  { mode: 'months_from_last_visit', label: '最後の来場から' },
];

/** 有効期限(期限なし / もらった日から○か月 / 最後の来場から○か月) */
function ExpiryField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const id = useId();
  const v = value as { mode: ExpiryRule['mode']; months?: number | string };
  return (
    <div className="field">
      <span className="label" id={id}>
        {label}
      </span>
      <div className="cfg-expiry">
        <div className="segment cfg-seg" role="radiogroup" aria-labelledby={id}>
          {EXPIRY_MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={v.mode === m.mode}
              onClick={() =>
                onChange(m.mode === 'none' ? { mode: 'none' } : { mode: m.mode, months: v.mode === 'none' ? 12 : v.months })
              }
            >
              {m.label}
            </button>
          ))}
        </div>
        {v.mode !== 'none' && (
          <div className="cfg-num">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              aria-label={`${label}(か月)`}
              value={String(v.months ?? '')}
              onChange={(e) => onChange({ mode: v.mode, months: e.target.value })}
            />
            <span className="sub-text">か月</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PointsSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(
    settings,
    ['points_per_ticket', 'daily_point_limit', 'grant_point_on_ticket_day', 'point_expiry', 'ticket_expiry', 'merge_keep_same_day_points'],
    onSaved,
  );
  return (
    <SettingsForm
      title="ポイントと無料券"
      desc="変えた内容は、次のチェックインから使われます。すでにたまっているポイントと、持っている無料券はそのままです。"
      state={s}
    >
      <div className="cfg-row">
        <NumField
          label="無料券1枚に必要なポイント数"
          unit="ポイント"
          min={1}
          max={100}
          value={s.draft.points_per_ticket}
          onChange={(v) => s.set('points_per_ticket', v)}
        />
        <NumField
          label="1日にもらえるポイントの上限"
          unit="ポイント"
          hint="おうちごとの上限です"
          min={1}
          max={10}
          value={s.draft.daily_point_limit}
          onChange={(v) => s.set('daily_point_limit', v)}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={s.draft.grant_point_on_ticket_day === true}
          onChange={(e) => s.set('grant_point_on_ticket_day', e.target.checked)}
        />
        無料券を使った日にもポイントを付ける
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={s.draft.merge_keep_same_day_points === true}
          onChange={(e) => s.set('merge_keep_same_day_points', e.target.checked)}
        />
        おうちをまとめたとき、同じ日に別々に来ていた分のポイントもそのまま残す
      </label>
      <ExpiryField label="ポイントの有効期限" value={s.draft.point_expiry} onChange={(v) => s.set('point_expiry', v)} />
      <ExpiryField label="無料券の有効期限" value={s.draft.ticket_expiry} onChange={(v) => s.set('ticket_expiry', v)} />
    </SettingsForm>
  );
}

function AnalysisSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['repeat_days', 'dormant_days', 'dormant_min_visits', 'weather_station'], onSaved);
  const station = (s.draft.weather_station ?? { code: '', name: '' }) as { code: string; name: string };
  const stationId = useId();
  return (
    <SettingsForm title="分析の基準" desc="ダッシュボードの「リピート率」と「休眠している常連」の数え方と、天気を取る観測地点です。" state={s}>
      <NumField
        label="リピート率の日数"
        unit="日以内"
        hint="初めて来たおうちが、この日数のうちにもう一度来たら「リピート」と数えます"
        min={1}
        max={365}
        value={s.draft.repeat_days}
        onChange={(v) => s.set('repeat_days', v)}
      />
      <div className="cfg-row">
        <NumField
          label="常連とみなす来場回数"
          unit="回以上"
          min={1}
          max={100}
          value={s.draft.dormant_min_visits}
          onChange={(v) => s.set('dormant_min_visits', v)}
        />
        <NumField
          label="休眠とみなす日数"
          unit="日来ていない"
          min={1}
          max={730}
          value={s.draft.dormant_days}
          onChange={(v) => s.set('dormant_days', v)}
        />
      </div>
      <div className="cfg-row">
        <div className="field">
          <label htmlFor={`${stationId}-code`}>天気の観測地点の番号</label>
          <input
            id={`${stationId}-code`}
            inputMode="numeric"
            maxLength={5}
            value={station.code}
            onChange={(e) => s.set('weather_station', { ...station, code: e.target.value })}
          />
          <span className="hint">気象庁のアメダスの地点番号(5桁)。ドッグランに一番近い地点を入れてください</span>
        </div>
        <div className="field">
          <label htmlFor={`${stationId}-name`}>観測地点の名前</label>
          <input
            id={`${stationId}-name`}
            maxLength={40}
            value={station.name}
            onChange={(e) => s.set('weather_station', { ...station, name: e.target.value })}
          />
        </div>
      </div>
    </SettingsForm>
  );
}

function InviteSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['invite_ttl_hours', 'reception_invite_ttl_minutes'], onSaved);
  return (
    <SettingsForm title="招待" desc="家族をおうちに招待するときの、招待の有効時間です。" state={s}>
      <div className="cfg-row">
        <NumField
          label="お客さん同士の招待"
          unit="時間"
          hint="LINEで送った招待が使える時間"
          min={1}
          max={168}
          value={s.draft.invite_ttl_hours}
          onChange={(v) => s.set('invite_ttl_hours', v)}
        />
        <NumField
          label="受付で出す招待QRコード"
          unit="分"
          hint="おうちの詳細の「家族を追加」で出すQRコード"
          min={1}
          max={120}
          value={s.draft.reception_invite_ttl_minutes}
          onChange={(v) => s.set('reception_invite_ttl_minutes', v)}
        />
      </div>
    </SettingsForm>
  );
}

/** 受付の固定QRコード。合言葉を作り直すと、前に印刷したQRコードは使えなくなる */
function CheckinQrSection({ data, onSaved }: { data: SettingsResponse; onSaved: OnSaved }) {
  const s = useSettingsDraft(data.settings, ['liff_id'], onSaved);
  const { readOnly } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const url = new URL(data.checkinUrl, location.origin).href;
  const id = useId();
  return (
    <SettingsForm
      title="受付のQRコード"
      desc="お客さんがチェックインのときに読み取るQRコードです。印刷して受付に置いてください。"
      state={s}
    >
      <div className="cfg-qr-row">
        <div className="cfg-qr-frame">
          <QrCode value={url} label="受付のQRコード" onImage={setImage} />
        </div>
        <div className="cfg-qr-side">
          <dl className="cfg-qr-meta">
            <div>
              <dt>QRコードの中身</dt>
              <dd className="mono cfg-break">{url}</dd>
            </div>
            <div>
              <dt>合言葉</dt>
              <dd className="mono cfg-break" data-testid="passphrase">
                {data.settings.checkin_passphrase}
              </dd>
            </div>
          </dl>
          <div className="cfg-acts">
            {image && (
              <a className="btn sub" href={image} download="受付のQRコード.png">
                画像を保存する
              </a>
            )}
            {!readOnly && (
              <button type="button" className="btn sub" onClick={() => setConfirming(true)}>
                合言葉を作り直す
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="field">
        <label htmlFor={id}>LINEミニアプリの番号</label>
        <input
          id={id}
          className="cfg-wide"
          value={String(s.draft.liff_id ?? '')}
          placeholder="例: 1234567890-AbCdEfGh"
          onChange={(e) => s.set('liff_id', e.target.value)}
        />
        <span className="hint">
          製作者から伝えられた番号を入れます。空欄のときは、この管理画面と同じアドレスのお客さん向け画面を指します。
        </span>
      </div>
      {confirming && (
        <RegenerateDialog
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            onSaved(r);
            setConfirming(false);
          }}
        />
      )}
    </SettingsForm>
  );
}

function RegenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: OnSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await adminPost<SettingsResponse>('/settings/checkin-passphrase'));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="受付のQRコードを作り直す"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy} onClick={submit}>
            <BusyLabel busy={busy} pending="作り直しています…">
              作り直す
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>新しい合言葉で、受付のQRコードを作り直します。</p>
      <ul className="plain-list">
        <li>前に印刷したQRコードでは、チェックインできなくなります</li>
        <li>新しいQRコードを印刷して、受付のものと取り替えてください</li>
        <li>間違えたときは、操作ログから元に戻せます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

function MigrationSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['migration_period', 'migration_max_points'], onSaved);
  const p = s.draft.migration_period as { start: string | null; end: string | null };
  const startId = useId();
  const endId = useId();
  return (
    <SettingsForm
      title="移行期間"
      desc="旧カード(LINEのショップカード・紙のスタンプカード)からポイントを、受付で引き継げる期間と、一度に引き継げるポイントの上限です。期間が終わると、以前の引き継ぎの申請の写真は自動で消えます。"
      state={s}
    >
      <div className="cfg-row">
        <div className="field">
          <label htmlFor={startId}>開始日</label>
          <input
            id={startId}
            type="date"
            className="cfg-date"
            value={p.start ?? ''}
            onChange={(e) => s.set('migration_period', { ...p, start: e.target.value || null })}
          />
        </div>
        <div className="field">
          <label htmlFor={endId}>終了日</label>
          <input
            id={endId}
            type="date"
            className="cfg-date"
            value={p.end ?? ''}
            onChange={(e) => s.set('migration_period', { ...p, end: e.target.value || null })}
          />
        </div>
      </div>
      <NumField
        label="旧カードから引き継げるポイントの上限"
        unit="ポイントまで"
        hint="これを超えるポイントは、旧カードの引き継ぎで入力できません(1〜200)"
        min={1}
        max={200}
        value={s.draft.migration_max_points}
        onChange={(v) => s.set('migration_max_points', v)}
      />
    </SettingsForm>
  );
}

function TermsSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['terms_text', 'privacy_text'], onSaved);
  const termsId = useId();
  const privacyId = useId();
  return (
    <SettingsForm
      title="利用規約・プライバシーポリシー"
      desc="お客さんが初めて登録するときと、家族として参加するときに表示されます。"
      state={s}
    >
      <div className="field">
        <label htmlFor={termsId}>利用規約</label>
        <textarea
          id={termsId}
          className="cfg-textarea"
          rows={8}
          value={String(s.draft.terms_text ?? '')}
          onChange={(e) => s.set('terms_text', e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={privacyId}>プライバシーポリシー</label>
        <textarea
          id={privacyId}
          className="cfg-textarea"
          rows={8}
          value={String(s.draft.privacy_text ?? '')}
          onChange={(e) => s.set('privacy_text', e.target.value)}
        />
      </div>
    </SettingsForm>
  );
}

function ContactSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['developer_contact'], onSaved);
  const id = useId();
  return (
    <SettingsForm title="製作者の連絡先" desc="「使い方・困ったとき」の画面に表示します。受付スタッフも見られます。" state={s}>
      <div className="field">
        <label htmlFor={id}>連絡先</label>
        <textarea
          id={id}
          className="cfg-textarea"
          rows={4}
          value={String(s.draft.developer_contact ?? '')}
          placeholder="例: 山田(製作者) 090-0000-0000 / 平日 10時〜18時"
          onChange={(e) => s.set('developer_contact', e.target.value)}
        />
      </div>
    </SettingsForm>
  );
}

/** 施設の名前(担当I)。お客さんの会員証と、受付・管理画面の見出しに出す */
function FacilitySection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['facility_name'], onSaved);
  const id = useId();
  const hintId = useId();
  return (
    <SettingsForm
      title="施設の名前"
      desc="お客さんの会員証の上(「グリーンドーム 会員証」など)と、この画面の左上に出す名前です。"
      state={s}
    >
      <div className="field">
        <label htmlFor={id}>施設の名前</label>
        <input
          id={id}
          type="text"
          className="cfg-wide"
          maxLength={30}
          aria-describedby={hintId}
          value={String(s.draft.facility_name ?? '')}
          onChange={(e) => s.set('facility_name', e.target.value)}
        />
        <p className="hint" id={hintId}>
          30文字まで
        </p>
      </div>
    </SettingsForm>
  );
}
