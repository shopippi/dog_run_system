import {
  BOOKING_SERVICE_LABELS,
  DOG_SIZE_LABELS,
  addDays,
  bookingWhenText,
  checkBookingDates,
  estimateBooking,
  timeOptions,
  toJstDate,
  type AdminBookingSaved,
  type BookingDogOption,
  type BookingFullDetails,
  type BookingRules,
  type BookingService,
  type HouseholdHit,
} from '@dr/shared';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BusyLabel } from '../../components/BusyLabel';
import { DogFace } from '../../components/DogFace';
import { ErrorNotice } from '../../components/ErrorNotice';
import { HouseholdPicker } from '../../components/HouseholdPicker';
import { PageHead } from '../../components/PageHead';
import { Loading, SkeletonText } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useLoad } from '../../hooks/useLoad';
import { ApiError, adminApi, adminPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { EstimateTable } from './parts';

/**
 * M-22 予約を入れる(A-20)。電話や DM で受けた予約を、受付で入れる(手書きの台帳の代わり)。
 * おうちを探して選ぶ → ワンちゃん → 種類と日にち・時刻 → メモ → 入れる。受付で入れた予約はいつも確定(LINE のお知らせは送らない)。
 * 受け入れる頭数を超えるときは知らせる。管理者は理由を書けば入れられる。
 */
export function BookingNewPage() {
  const opts = useLoad(() => adminApi<{ today: string; rules: BookingRules }>('/bookings/options'), []);
  const [household, setHousehold] = useState<HouseholdHit | null>(null);
  return (
    <div className="page">
      <PageHead
        title="予約を入れる"
        howto="電話やLINEのトークで受けた予約を入れます。おうちを探して選び、ワンちゃんと日にちを選んで「予約を入れる」を押してください。受付で入れた予約は、すぐ確定になります。"
        crumbs={[{ label: '予約カレンダー', to: '/bookings' }, { label: '予約を入れる' }]}
      />
      {opts.error ? <ErrorNotice error={opts.error} onRetry={() => void opts.reload()} /> : null}
      {!household ? (
        <section className="panel bk-new-pick">
          <h2 className="bk-h2">おうちを選ぶ</h2>
          <HouseholdPicker label="予約を入れるおうち" onPick={setHousehold} />
        </section>
      ) : opts.data ? (
        <EntryForm key={household.id} household={household} rules={opts.data.rules} today={opts.data.today} onChangeHousehold={() => setHousehold(null)} />
      ) : (
        <Loading>
          <section className="panel bk-new-form">
            <SkeletonText size={15} lines={4} />
          </section>
        </Loading>
      )}
    </div>
  );
}

function EntryForm({
  household,
  rules,
  today,
  onChangeHousehold,
}: {
  household: HouseholdHit;
  rules: BookingRules;
  today: string;
  onChangeHousehold: () => void;
}) {
  const dogs = useLoad(() => adminApi<{ dogs: BookingDogOption[] }>(`/bookings/household-dogs/${household.id}`), [household.id]);
  const { staff } = useAuth();
  const isAdmin = staff?.role === 'admin';
  const navigate = useNavigate();
  const toast = useToast();
  const times = timeOptions(rules);
  const [service, setService] = useState<BookingService>('daycare');
  const [dogIds, setDogIds] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(addDays(today, 1));
  const [endDate, setEndDate] = useState(addDays(today, 2));
  const [startTime, setStartTime] = useState(times.includes('10:00') ? '10:00' : times[0]!);
  const [endTime, setEndTime] = useState(times.includes('17:00') ? '17:00' : times.at(-1)!);
  const [note, setNote] = useState('');
  const [staffNote, setStaffNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [full, setFull] = useState<BookingFullDetails['dates'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = useId();

  useEffect(() => {
    if (dogs.data && dogs.data.dogs.length === 1) setDogIds([dogs.data.dogs[0]!.id]);
  }, [dogs.data]);

  const input = { service, startDate, endDate: service === 'daycare' ? startDate : endDate, startTime, endTime };
  const problem = checkBookingDates(rules, input, toJstDate(new Date()), { ignoreWindow: true });
  const picked = (dogs.data?.dogs ?? []).filter((d) => dogIds.includes(d.id));
  const estimate = picked.length > 0 && !problem ? estimateBooking(rules, { ...input, dogs: picked.map((d) => ({ id: d.id, name: d.name, size: d.size })) }) : null;

  // 入力が変わったら、「いっぱい」の知らせを消す
  useEffect(() => {
    setFull(null);
    setError(null);
  }, [service, startDate, endDate, dogIds.join(',')]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<AdminBookingSaved>('/bookings', {
        householdId: household.id,
        dogIds,
        ...input,
        note: note || null,
        staffNote: staffNote || null,
        overrideReason: full && isAdmin ? overrideReason || null : null,
      });
      toast({ message: `${household.displayName}の${BOOKING_SERVICE_LABELS[service]}の予約を入れました。`, undo: { auditId: r.auditId } });
      navigate(`/bookings?service=${service}&date=${r.booking.startDate}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'booking_full') setFull((e.details as BookingFullDetails | undefined)?.dates ?? []);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel bk-new-form">
      <div className="sel-head">
        <div className="sel-title">
          <h2>{household.displayName}</h2>
          <span className="sub-text mono">{household.memberNo}</span>
        </div>
        <button type="button" className="btn ghost" onClick={onChangeHousehold}>
          おうちを選び直す
        </button>
      </div>

      <div className="field">
        <span className="label" id={`${id}-svc`}>種類</span>
        <div className="segment" role="tablist" aria-labelledby={`${id}-svc`}>
          {(['daycare', 'boarding'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={service === s} onClick={() => setService(s)}>
              {BOOKING_SERVICE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label" id={`${id}-dogs`}>ワンちゃん</span>
        {dogs.error ? <ErrorNotice error={dogs.error} onRetry={() => void dogs.reload()} /> : null}
        {!dogs.data ? (
          !dogs.error && <SkeletonText size={15} lines={2} />
        ) : dogs.data.dogs.length === 0 ? (
          <p className="sub-text">登録中のワンちゃんがいません。おうちの詳細で、ワンちゃんを確かめてください。</p>
        ) : (
          <div className="pick-list" role="group" aria-labelledby={`${id}-dogs`}>
            {dogs.data.dogs.map((d) => (
              <label key={d.id} className="pick-row">
                <input
                  type="checkbox"
                  checked={dogIds.includes(d.id)}
                  onChange={() => setDogIds((xs) => (xs.includes(d.id) ? xs.filter((x) => x !== d.id) : [...xs, d.id]))}
                />
                <DogFace name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
                <span className="pick-body">
                  <b>{d.name}</b>
                  <span className="sub-text">
                    {DOG_SIZE_LABELS[d.size]}
                    {d.experienced ? '' : '・はじめての預かり'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="cfg-row">
        <div className="field date-field">
          <label htmlFor={`${id}-sd`}>{service === 'daycare' ? '日にち' : 'チェックインの日'}</label>
          <input id={`${id}-sd`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        {service === 'boarding' && (
          <div className="field date-field">
            <label htmlFor={`${id}-ed`}>チェックアウトの日</label>
            <input id={`${id}-ed`} type="date" value={endDate} min={addDays(startDate, 1)} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-st`}>{service === 'daycare' ? '預ける時刻' : 'チェックインの時刻'}</label>
          <select id={`${id}-st`} value={startTime} onChange={(e) => setStartTime(e.target.value)}>
            {times.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-et`}>{service === 'daycare' ? 'お迎えの時刻' : 'チェックアウトの時刻'}</label>
          <select id={`${id}-et`} value={endTime} onChange={(e) => setEndTime(e.target.value)}>
            {times.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      {problem ? <p className="err-text">{problem}</p> : <p className="sub-text">{bookingWhenText(input)}</p>}

      <div className="cfg-row bk-new-notes">
        <div className="field">
          <label htmlFor={`${id}-note`}>お客さんからのメモ(ごはん・お薬・体調など)</label>
          <textarea id={`${id}-note`} className="cfg-textarea" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-sn`}>受付のメモ</label>
          <textarea id={`${id}-sn`} className="cfg-textarea" maxLength={500} value={staffNote} placeholder="例: 電話で受けた" onChange={(e) => setStaffNote(e.target.value)} />
        </div>
      </div>

      {estimate && <EstimateTable estimate={estimate} />}

      {full && (
        <div className="alert warning" role="alert">
          <p>
            <b>受け入れる頭数を超えます。</b>
          </p>
          <ul className="plain-list">
            {full.map((f) => (
              <li key={`${f.date}-${f.size}`}>
                {f.date.slice(5).replace('-', '/')} の{DOG_SIZE_LABELS[f.size]}: いま {f.used}頭 / 受け入れ {f.caps}頭(あと{f.need}頭は入りません)
              </li>
            ))}
          </ul>
          {isAdmin ? (
            <div className="field">
              <label htmlFor={`${id}-ov`}>それでも入れる理由(管理者)</label>
              <input id={`${id}-ov`} maxLength={200} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="例: 常連さんで、スタッフを増やして対応する" />
            </div>
          ) : (
            <p>別の日にするか、管理者に相談してください。</p>
          )}
        </div>
      )}
      {error && !full ? <ErrorNotice error={error} /> : null}

      <div className="proxy-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || dogIds.length === 0 || !!problem || (!!full && (!isAdmin || overrideReason.trim() === ''))}
          onClick={() => void submit()}
        >
          <BusyLabel busy={busy} pending="入れています…">
            {full && isAdmin ? '理由を書いて予約を入れる' : '予約を入れる'}
          </BusyLabel>
        </button>
      </div>
    </section>
  );
}
