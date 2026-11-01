import { photoWatermarkText, type PhotoAvailability, type Settings, type SettingsResponse } from '@dr/shared';
import { useId } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { CfgSectionSkeleton, useLoaded } from '../../components/SettingsKit';
import { Loading } from '../../components/Skeleton';
import { publishFacilityName } from '../../hooks/useFacilityName';
import { useLoad } from '../../hooks/useLoad';
import { adminApi } from '../../lib/api';
import { NumField, SettingsForm, useSettingsDraft } from '../SettingsPage';
import { PhotoSalesFrame } from './PhotoSalesFrame';
import './settings/photo-settings.css';

// PA-7 写真販売の設定(段階1-D)。ルールの設定・予約の設定と同じしくみ(GET / PATCH /admin/api/settings の photo_ の項目)。
// まとまりごとに保存し、操作ログから元に戻せる。管理者だけが変えられる(製作者は見るだけ・API が 403。受付スタッフは開けない)。
// 「販売する」は、写真の置き場所(R2)とお支払い(Stripe)の設定がそろっていなければ選べない(理由を出す)。

type OnSaved = (r: SettingsResponse) => void;
const toNum = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

export function PhotoSettingsPage() {
  const { data, setData, error, reload } = useLoaded(() => adminApi<SettingsResponse>('/settings'));
  const availability = useLoad(() => adminApi<PhotoAvailability>('/photos/availability'), [data?.settings.photo_sales_enabled]);
  return (
    <PhotoSalesFrame
      title="写真販売の設定"
      howto="販売を始める・止めるや、透かしの文字、特定商取引法に基づく表記を変えられます。まとまりごとに「保存する」を押してください。変えた内容は操作ログに残り、そこから元に戻せます。"
    >
      <div className="cfg-page ps-page">
        {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
        {!data ? (
          !error && (
            <Loading>
              <CfgSectionSkeleton fields={1} title={120} fieldW="min(420px, 100%)" />
              <CfgSectionSkeleton fields={2} title={140} fieldW="min(320px, 100%)" />
              <CfgSectionSkeleton fields={2} title={120} />
            </Loading>
          )
        ) : (
          <>
            <SalesSection settings={data.settings} availability={availability.data} onSaved={setData} />
            <WatermarkSection
              settings={data.settings}
              onSaved={(r) => {
                setData(r);
                publishFacilityName(r.settings.facility_name);
              }}
            />
            <PeriodSection settings={data.settings} onSaved={setData} />
            <DownloadSection settings={data.settings} onSaved={setData} />
            <LegalSection settings={data.settings} onSaved={setData} />
          </>
        )}
      </div>
    </PhotoSalesFrame>
  );
}

/** 置き場所・決済がそろっていないときの理由(そろっていれば null) */
function blockedReason(a: PhotoAvailability | null): string | null {
  if (!a) return null;
  if (a.storage === 'missing' || a.payments === 'missing') return a.message;
  return null;
}

function SalesSection({ settings, availability, onSaved }: { settings: Settings; availability: PhotoAvailability | null; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['photo_sales_enabled', 'photo_notify_purchase'], onSaved);
  const reason = blockedReason(availability);
  const enabled = s.draft.photo_sales_enabled === true;
  const reasonId = useId();
  return (
    <SettingsForm
      title="販売する・止める"
      desc="販売するにすると、お客さんの LINE に「写真」が出て、写真を買えるようになります。止めると、お客さんには「準備中」と出ます(購入した写真は、止めても見られます)。"
      state={s}
    >
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          // 止めるのはいつでもできる。始めるのは、置き場所と決済がそろってから
          disabled={!enabled && !!reason}
          aria-describedby={reason ? reasonId : undefined}
          onChange={(e) => s.set('photo_sales_enabled', e.target.checked)}
        />
        写真を販売する
      </label>
      {reason && (
        <p className="ps-blocked" id={reasonId}>
          {reason}
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={s.draft.photo_notify_purchase === true} onChange={(e) => s.set('photo_notify_purchase', e.target.checked)} />
        購入が済んだら、お客さんの LINE に「ご購入ありがとうございます」を送る
      </label>
      <p className="hint">予約のお知らせと合わせて、ひと月に送れる数(予約の設定)に数えます。</p>
    </SettingsForm>
  );
}

function WatermarkSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['facility_name', 'photo_watermark_text'], onSaved);
  const nameId = useId();
  const wmId = useId();
  const hintId = useId();
  const sample = photoWatermarkText({ photo_watermark_text: String(s.draft.photo_watermark_text ?? ''), facility_name: String(s.draft.facility_name ?? '') });
  return (
    <SettingsForm
      title="施設の名前と透かしの文字"
      desc="お客さんが見る写真(小さな写真と大きな写真)には、全体に斜めに透かしの文字が入ります。購入した写真には入りません。変えた文字は、これからアップロードする写真に使います。"
      state={s}
    >
      <div className="field">
        <label htmlFor={nameId}>施設の名前</label>
        <input
          id={nameId}
          type="text"
          className="cfg-wide"
          maxLength={30}
          value={String(s.draft.facility_name ?? '')}
          onChange={(e) => s.set('facility_name', e.target.value)}
        />
        <p className="hint">30文字まで。会員証や、特定商取引法に基づく表記の見出しにも出ます。</p>
      </div>
      <div className="field">
        <label htmlFor={wmId}>透かしの文字</label>
        <input
          id={wmId}
          type="text"
          className="cfg-wide"
          maxLength={40}
          aria-describedby={hintId}
          placeholder={`${String(s.draft.facility_name ?? '')} SAMPLE`}
          value={String(s.draft.photo_watermark_text ?? '')}
          onChange={(e) => s.set('photo_watermark_text', e.target.value)}
        />
        <p className="hint" id={hintId}>
          40文字まで。空のときは「施設の名前 SAMPLE」になります。
        </p>
      </div>
      <div className="ps-wm-sample" aria-label="透かしの見本">
        <span className="sub-text">見本</span>
        <span className="ps-wm-text">{sample}</span>
      </div>
    </SettingsForm>
  );
}

function PeriodSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['photo_sale_months', 'photo_deletion_notice_days'], onSaved);
  return (
    <SettingsForm
      title="販売期間"
      desc="アルバムを公開した日から、この期間だけ販売します。アルバムごとに延ばせます(アルバムの画面)。販売が終わった翌晩に、売れなかった写真のファイルは消え、購入された写真は残ります。"
      state={s}
    >
      <div className="cfg-row">
        <NumField
          label="販売期間"
          unit="か月"
          min={1}
          max={36}
          value={s.draft.photo_sale_months}
          onChange={(v) => s.set('photo_sale_months', v)}
        />
        <NumField
          label="販売終了のお知らせ"
          unit="日前"
          hint="写真販売のダッシュボードと、システムの状態に出します"
          min={1}
          max={60}
          value={s.draft.photo_deletion_notice_days}
          onChange={(v) => s.set('photo_deletion_notice_days', v)}
        />
      </div>
    </SettingsForm>
  );
}

function DownloadSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['photo_download_limit', 'photo_refund_days'], onSaved);
  const limit = s.draft.photo_download_limit as Settings['photo_download_limit'];
  const hoursId = useId();
  const countId = useId();
  const show = (n: number) => (Number.isNaN(n) ? '' : String(n));
  return (
    <SettingsForm
      title="ダウンロードと返金"
      desc="お客さんは、購入した写真を何度でもダウンロードできます。ただし、写真1枚につき、決めた時間の中の回数までです。"
      state={s}
    >
      <fieldset className="ps-limit">
        <legend className="label">ダウンロードの回数の上限(写真1枚につき)</legend>
        <div className="cfg-row">
          <div className="field">
            <label htmlFor={hoursId}>時間</label>
            <div className="cfg-num">
              <input
                id={hoursId}
                type="number"
                inputMode="numeric"
                min={1}
                max={168}
                value={show(limit.hours)}
                onChange={(e) => s.set('photo_download_limit', { ...limit, hours: toNum(e.target.value) })}
              />
              <span className="sub-text">時間で</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor={countId}>回数</label>
            <div className="cfg-num">
              <input
                id={countId}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={show(limit.count)}
                onChange={(e) => s.set('photo_download_limit', { ...limit, count: toNum(e.target.value) })}
              />
              <span className="sub-text">回まで</span>
            </div>
          </div>
        </div>
      </fieldset>
      <NumField
        label="返金を受け付ける期間(購入から)"
        unit="日以内"
        hint="まだ一度もダウンロードしていない写真だけです。期間の外は、注文の画面で理由を書けば返金できます"
        min={0}
        max={60}
        value={s.draft.photo_refund_days}
        onChange={(v) => s.set('photo_refund_days', v)}
      />
    </SettingsForm>
  );
}

function LegalSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['photo_tokushoho_text', 'photo_terms_text'], onSaved);
  const tId = useId();
  const termsId = useId();
  return (
    <SettingsForm
      title="特定商取引法に基づく表記・利用規約"
      desc="お客さんの写真の画面と、ログインなしで開けるページに出します。お支払いの審査にも使われます。"
      state={s}
    >
      <div className="field">
        <label htmlFor={tId}>特定商取引法に基づく表記</label>
        <textarea
          id={tId}
          className="cfg-textarea"
          rows={10}
          maxLength={20000}
          value={String(s.draft.photo_tokushoho_text ?? '')}
          onChange={(e) => s.set('photo_tokushoho_text', e.target.value)}
        />
        <p className="hint">販売者(施設の名義)・責任者・所在地・電話番号・メール・販売価格・支払い方法と時期・引き渡しの時期・返品について</p>
      </div>
      <div className="field">
        <label htmlFor={termsId}>利用規約(写真販売)</label>
        <textarea
          id={termsId}
          className="cfg-textarea"
          rows={10}
          maxLength={20000}
          value={String(s.draft.photo_terms_text ?? '')}
          onChange={(e) => s.set('photo_terms_text', e.target.value)}
        />
      </div>
    </SettingsForm>
  );
}
