import { DOG_SIZE_LABELS, type Settings, type SettingsResponse } from '@dr/shared';
import { useId } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PageHead } from '../../components/PageHead';
import { CfgSectionSkeleton, useLoaded } from '../../components/SettingsKit';
import { Loading } from '../../components/Skeleton';
import { adminApi } from '../../lib/api';
import { NumField, SettingsForm, useSettingsDraft } from '../SettingsPage';

type OnSaved = (r: SettingsResponse) => void;
const SIZES = ['small', 'medium', 'large'] as const;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const toNum = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

/**
 * M-23 予約の設定(A-22)。受け入れる頭数・料金の目安・時間・キャンセルの期限・すべて承認制・確かめてもらうこと・LINE のお知らせ。
 * ルールの設定と同じしくみ(settings)で保存し、操作ログから元に戻せる。管理者だけ(受付スタッフは 403、製作者は見るだけ)。
 * 日ごとの受け入れ数(休み・増やす・減らす)は、予約カレンダーの日のパネルで変える。
 */
export function BookingSettingsPage() {
  const { data, setData, error, reload } = useLoaded(() => adminApi<SettingsResponse>('/settings'));
  return (
    <div className="page cfg-page">
      <PageHead
        title="予約の設定"
        howto="預かり・お泊まりの予約のきまりです。まとまりごとに「保存する」を押してください。日ごとに休みにする・頭数を変えるときは、予約カレンダーで日を押してください。"
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        !error && (
          <Loading>
            <CfgSectionSkeleton fields={2} title={120} />
            <CfgSectionSkeleton fields={3} title={140} />
            <CfgSectionSkeleton fields={3} title={100} />
          </Loading>
        )
      ) : (
        <>
          <AcceptSection settings={data.settings} onSaved={setData} />
          <CapacitySection settings={data.settings} onSaved={setData} />
          <PriceSection settings={data.settings} onSaved={setData} />
          <TimeSection settings={data.settings} onSaved={setData} />
          <ChecklistSection settings={data.settings} onSaved={setData} />
          <NotifySection settings={data.settings} onSaved={setData} />
        </>
      )}
    </div>
  );
}

function AcceptSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['booking_enabled', 'booking_approve_all'], onSaved);
  return (
    <SettingsForm
      title="予約の受け付け"
      desc="はじめてのワンちゃんがいる予約は、いつもお店の確認を待ちます。預かったことのある子だけの予約は、すぐ確定します。"
      state={s}
    >
      <label className="check">
        <input type="checkbox" checked={s.draft.booking_enabled === true} onChange={(e) => s.set('booking_enabled', e.target.checked)} />
        お客さんがLINEから予約できるようにする
      </label>
      <label className="check">
        <input type="checkbox" checked={s.draft.booking_approve_all === true} onChange={(e) => s.set('booking_approve_all', e.target.checked)} />
        すべて承認制にする(預かったことのある子の予約も、お店が確認してから確定する)
      </label>
    </SettingsForm>
  );
}

/** サイズごとの数の入力(受け入れる頭数・料金) */
function SizeGrid({
  label,
  unit,
  value,
  onChange,
  max,
}: {
  label: string;
  unit: string;
  value: Record<(typeof SIZES)[number], number>;
  onChange: (v: Record<(typeof SIZES)[number], number>) => void;
  max: number;
}) {
  const id = useId();
  return (
    <fieldset className="bk-size-grid">
      <legend className="label">{label}</legend>
      <div className="cfg-row">
        {SIZES.map((sz) => (
          <div key={sz} className="field">
            <label htmlFor={`${id}-${sz}`}>{DOG_SIZE_LABELS[sz]}</label>
            <div className="cfg-num">
              <input
                id={`${id}-${sz}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={max}
                value={Number.isNaN(value[sz]) ? '' : String(value[sz])}
                onChange={(e) => onChange({ ...value, [sz]: toNum(e.target.value) })}
              />
              <span className="sub-text">{unit}</span>
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function CapacitySection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['booking_capacity'], onSaved);
  const cap = s.draft.booking_capacity as Settings['booking_capacity'];
  return (
    <SettingsForm
      title="受け入れる頭数"
      desc="サイズごとの、ふだんの受け入れる頭数です。確認待ちの予約も枠を使います。お断り・キャンセルで空きます。"
      state={s}
    >
      <SizeGrid label="預かり(1日あたり)" unit="頭" max={100} value={cap.daycare} onChange={(v) => s.set('booking_capacity', { ...cap, daycare: v })} />
      <SizeGrid label="お泊まり(1泊あたり)" unit="頭" max={100} value={cap.boarding} onChange={(v) => s.set('booking_capacity', { ...cap, boarding: v })} />
    </SettingsForm>
  );
}

function PriceSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['booking_prices'], onSaved);
  const p = s.draft.booking_prices as Settings['booking_prices'];
  return (
    <SettingsForm
      title="料金の目安"
      desc="予約の画面に「目安。お支払いは受付で」と一緒に出します。変えた料金は、これからの予約に使います(入っている予約の目安は変わりません)。"
      state={s}
    >
      <SizeGrid label="預かり(1日)" unit="円" max={1000000} value={p.daycare} onChange={(v) => s.set('booking_prices', { ...p, daycare: v })} />
      <SizeGrid label="お泊まり(1泊)" unit="円" max={1000000} value={p.boarding} onChange={(v) => s.set('booking_prices', { ...p, boarding: v })} />
      <label className="check">
        <input
          type="checkbox"
          checked={p.half_day.enabled}
          onChange={(e) => s.set('booking_prices', { ...p, half_day: { ...p.half_day, enabled: e.target.checked } })}
        />
        短い預かりは半日の料金にする
      </label>
      {p.half_day.enabled && (
        <>
          <NumField
            label="半日とみなす時間"
            unit="時間以内"
            min={1}
            max={12}
            value={Number.isNaN(p.half_day.max_hours) ? '' : p.half_day.max_hours}
            onChange={(v) => s.set('booking_prices', { ...p, half_day: { ...p.half_day, max_hours: toNum(v) } })}
          />
          <SizeGrid
            label="預かり(半日)"
            unit="円"
            max={1000000}
            value={p.half_day.price}
            onChange={(v) => s.set('booking_prices', { ...p, half_day: { ...p.half_day, price: v } })}
          />
        </>
      )}
    </SettingsForm>
  );
}

function TimeSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['booking_hours', 'booking_cancel_deadline', 'booking_window', 'booking_closed_weekdays'], onSaved);
  const h = s.draft.booking_hours as Settings['booking_hours'];
  const d = s.draft.booking_cancel_deadline as Settings['booking_cancel_deadline'];
  const w = s.draft.booking_window as Settings['booking_window'];
  const closed = s.draft.booking_closed_weekdays as number[];
  const id = useId();
  return (
    <SettingsForm title="時間と期限" desc="預ける・お迎えの時刻を選べる時間、キャンセルの期限、予約できる期間、予約を受けない曜日です。" state={s}>
      <div className="cfg-row">
        <div className="field">
          <label htmlFor={`${id}-open`}>受付を始める時刻</label>
          <input id={`${id}-open`} type="time" step={1800} value={h.open} onChange={(e) => s.set('booking_hours', { ...h, open: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-close`}>受付を終える時刻</label>
          <input id={`${id}-close`} type="time" step={1800} value={h.close} onChange={(e) => s.set('booking_hours', { ...h, close: e.target.value })} />
        </div>
      </div>
      <div className="cfg-row">
        <NumField
          label="キャンセルの期限(利用の何日前まで)"
          unit="日前"
          hint="0 にすると利用の当日"
          min={0}
          max={14}
          value={Number.isNaN(d.days_before) ? '' : d.days_before}
          onChange={(v) => s.set('booking_cancel_deadline', { ...d, days_before: toNum(v) })}
        />
        <div className="field">
          <label htmlFor={`${id}-dl`}>キャンセルの期限の時刻</label>
          <input id={`${id}-dl`} type="time" value={d.time} onChange={(e) => s.set('booking_cancel_deadline', { ...d, time: e.target.value })} />
        </div>
      </div>
      <div className="cfg-row">
        <NumField
          label="何日後から予約できるか"
          unit="日後から"
          hint="1 なら翌日から。0 なら今日から"
          min={0}
          max={30}
          value={Number.isNaN(w.min_days_ahead) ? '' : w.min_days_ahead}
          onChange={(v) => s.set('booking_window', { ...w, min_days_ahead: toNum(v) })}
        />
        <NumField
          label="何日後まで予約できるか"
          unit="日後まで"
          min={1}
          max={365}
          value={Number.isNaN(w.max_days_ahead) ? '' : w.max_days_ahead}
          onChange={(v) => s.set('booking_window', { ...w, max_days_ahead: toNum(v) })}
        />
        <NumField
          label="お泊まりの最長"
          unit="泊"
          min={1}
          max={30}
          value={Number.isNaN(w.max_nights) ? '' : w.max_nights}
          onChange={(v) => s.set('booking_window', { ...w, max_nights: toNum(v) })}
        />
      </div>
      <fieldset className="bk-size-grid">
        <legend className="label">予約を受けない曜日(定休日)</legend>
        <div className="chips">
          {WEEK.map((name, i) => (
            <label key={i}>
              <input
                type="checkbox"
                checked={closed.includes(i)}
                onChange={(e) => s.set('booking_closed_weekdays', e.target.checked ? [...closed, i].sort() : closed.filter((x) => x !== i))}
              />
              {name}
            </label>
          ))}
        </div>
        <span className="hint">臨時休業日(イベント・休業日の画面)は、予約も休みになります。</span>
      </fieldset>
    </SettingsForm>
  );
}

function ChecklistSection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['booking_checklist', 'booking_checklist_required'], onSaved);
  const list = s.draft.booking_checklist as string[];
  const id = useId();
  return (
    <SettingsForm
      title="予約のときに確かめてもらうこと"
      desc="予約の画面に、印を付ける項目として出します。1行に1つ書いてください(10個まで)。"
      state={s}
    >
      <div className="field">
        <label htmlFor={id}>確かめてもらうこと</label>
        <textarea
          id={id}
          className="cfg-textarea"
          value={list.join('\n')}
          onChange={(e) => s.set('booking_checklist', e.target.value.split('\n').map((x) => x.trim()).filter((x, i, xs) => x !== '' || i === xs.length - 1))}
          onBlur={(e) => s.set('booking_checklist', e.target.value.split('\n').map((x) => x.trim()).filter((x) => x !== ''))}
        />
        <span className="hint">例: 狂犬病・混合ワクチンの接種</span>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={s.draft.booking_checklist_required === true}
          onChange={(e) => s.set('booking_checklist_required', e.target.checked)}
        />
        すべてに印を付けないと予約できないようにする
      </label>
    </SettingsForm>
  );
}

function NotifySection({ settings, onSaved }: { settings: Settings; onSaved: OnSaved }) {
  const s = useSettingsDraft(settings, ['booking_notify'], onSaved);
  const n = s.draft.booking_notify as Settings['booking_notify'];
  return (
    <SettingsForm
      title="LINEでのお知らせ"
      desc="予約が確定したとき(すぐ確定・承認)と、お断りしたときに、お客さんのLINEに届きます。前の日のお知らせなどは送りません。今月送った数は「システムの状態」で見られます。"
      state={s}
    >
      <label className="check">
        <input type="checkbox" checked={n.confirmed} onChange={(e) => s.set('booking_notify', { ...n, confirmed: e.target.checked })} />
        確定したときに送る
      </label>
      <label className="check">
        <input type="checkbox" checked={n.declined} onChange={(e) => s.set('booking_notify', { ...n, declined: e.target.checked })} />
        お断りしたときに送る
      </label>
      <NumField
        label="ひと月に送る数の上限"
        unit="通"
        hint="LINEの無料のプランは月200通までです。上限に達したら、その月は送りません(予約はそのまま)"
        min={0}
        max={100000}
        value={Number.isNaN(n.monthly_limit) ? '' : n.monthly_limit}
        onChange={(v) => s.set('booking_notify', { ...n, monthly_limit: toNum(v) })}
      />
    </SettingsForm>
  );
}
