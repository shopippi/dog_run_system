import {
  BOOKING_SERVICE_LABELS,
  DOG_SIZE_LABELS,
  bookingWhenText,
  bookingWindow,
  estimateBooking,
  timeOptions,
  yen,
  type BookingDetail,
  type BookingOptionsResponse,
  type BookingService,
} from '@dr/shared';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionBar } from '../../components/ActionBar';
import { BusyLabel } from '../../components/BusyLabel';
import { DogAvatar } from '../../components/DogAvatar';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PressButton } from '../../components/PressButton';
import { Progress } from '../../components/Progress';
import { useToast } from '../../components/Toast';
import { ApiError, api, postJson } from '../../lib/api';
import { newId } from '../../lib/storage';
import { BookingFormSkeleton } from '../skeletons';
import { BookingCalendar } from './BookingCalendar';
import { EstimateBlock } from './EstimateBlock';

const STEPS = 4;

/**
 * L-14 予約する(C-15)。
 * 1. 預かりかお泊まりかと、ワンちゃん → 2. 日にちと時刻(空きのカレンダー) → 3. お店へのメモと確かめること → 4. 確かめて予約する
 * 経験のある子だけなら、すぐ確定。はじめての子がいれば、お店の確認を待つ。
 */
export function BookingNewPage() {
  const [opts, setOpts] = useState<BookingOptionsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    api<BookingOptionsResponse>('/api/bookings/options').then(setOpts).catch(setError);
  }, []);
  useEffect(load, [load]);
  if (error && !opts) return <main className="screen"><ErrorNotice error={error} onRetry={load} /></main>;
  if (!opts) return <BookingFormSkeleton />;
  if (!opts.rules.booking_enabled) {
    return (
      <main className="screen">
        <div className="page-head">
          <h2>予約する</h2>
        </div>
        <EmptyState icon="calendar">いまはLINEからの予約を受け付けていません。お店に直接ご連絡ください。</EmptyState>
      </main>
    );
  }
  return <Flow opts={opts} />;
}

function Flow({ opts }: { opts: BookingOptionsResponse }) {
  const { rules } = opts;
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [service, setService] = useState<BookingService>('daycare');
  const [dogIds, setDogIds] = useState<number[]>(() => (opts.dogs.length === 1 ? [opts.dogs[0]!.id] : []));
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const times = useMemo(() => timeOptions(rules), [rules]);
  const [startTime, setStartTime] = useState(() => (times.includes('10:00') ? '10:00' : times[0]!));
  const [endTime, setEndTime] = useState(() => (times.includes('17:00') ? '17:00' : times.at(-1)!));
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // 送信の印は「予約する」の画面ごとに1つ。電波が弱くて押し直しても、同じ予約として1回だけ受け付ける
  const [opKey, setOpKey] = useState(newId);
  const noteId = useId();
  const startId = useId();
  const endId = useId();

  const picked = opts.dogs.filter((d) => dogIds.includes(d.id));
  const firstTimers = picked.filter((d) => !d.experienced);
  const notices = picked.map((d) => d.vaccineNotice).filter((x): x is string => !!x);
  const win = bookingWindow(rules, opts.today);
  const datesReady = service === 'daycare' ? start !== null : start !== null && end !== null;
  const timeProblem = service === 'daycare' && start && endTime <= startTime ? 'お迎えの時刻は、預ける時刻より後にしてください。' : null;
  const checklistOk = !rules.booking_checklist_required || rules.booking_checklist.every((x) => checked.includes(x));
  const input = {
    service,
    startDate: start ?? '',
    endDate: (service === 'daycare' ? start : end) ?? '',
    startTime,
    endTime,
  };
  const estimate = datesReady ? estimateBooking(rules, { ...input, dogs: picked.map((d) => ({ id: d.id, name: d.name, size: d.size })) }) : null;

  const go = (n: number) => {
    setError(null);
    setStep(n);
    scrollTop();
  };

  const toggleDog = (id: number) => {
    setDogIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
    // ワンちゃんが変わると空きも変わるので、日にちを選び直してもらう
    setStart(null);
    setEnd(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<BookingDetail>(
        '/api/bookings',
        { ...input, dogIds, note: note.trim() || null, checklist: checked },
        { idempotencyKey: opKey },
      );
      toast(r.status === 'confirmed' ? '予約が確定しました。' : '予約を受け付けました。お店の確認をお待ちください。');
      navigate(`/bookings/${r.id}`, { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
      // 満員などで受け付けられなかったときは、次の送信は別の予約として送る
      if (e instanceof ApiError && e.status < 500 && e.code !== 'request_in_progress') setOpKey(newId());
    }
  };

  const backToDates = () => {
    setStart(null);
    setEnd(null);
    go(1);
  };

  return (
    <main className="screen bk-flow">
      <Progress step={step + 1} total={STEPS} label="予約の手順" />

      {step === 0 && (
        <>
          <div className="page-head">
            <h2>予約する</h2>
            <p className="lead">預かりかお泊まりかと、預けるワンちゃんを選んでください。</p>
          </div>
          <div className="field">
            <span className="label" id="bk-service">何を予約しますか</span>
            <div className="segment" role="radiogroup" aria-labelledby="bk-service">
              {(['daycare', 'boarding'] as const).map((s) => (
                <label key={s}>
                  <input
                    type="radio"
                    name="bk-service"
                    checked={service === s}
                    onChange={() => {
                      setService(s);
                      setStart(null);
                      setEnd(null);
                    }}
                  />
                  {BOOKING_SERVICE_LABELS[s]}
                </label>
              ))}
            </div>
            <span className="hint">{service === 'daycare' ? '日中にお預かりします(1日ずつ)。' : '夜もお預かりします(チェックインの日からチェックアウトの日まで)。'}</span>
          </div>
          <div className="field">
            <span className="label" id="bk-dogs">預けるワンちゃん</span>
            {opts.dogs.length === 0 ? (
              <EmptyState icon="paw">登録しているワンちゃんがいません。会員証の「ワンちゃん」から登録してください。</EmptyState>
            ) : (
              <div className="pick-list" role="group" aria-labelledby="bk-dogs">
                {opts.dogs.map((d) => (
                  <label key={d.id} className="pick-row">
                    <input type="checkbox" checked={dogIds.includes(d.id)} onChange={() => toggleDog(d.id)} />
                    <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
                    <span className="pick-body">
                      <b>{d.name}</b>
                      <span className="sub-text">
                        {d.breedName}・{DOG_SIZE_LABELS[d.size]}
                        {d.experienced ? '' : '・はじめての預かり'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {firstTimers.length > 0 && !rules.booking_approve_all && (
            <p className="note">はじめての子がいるので、お店が確認してから確定します。確定したらLINEでお知らせします。</p>
          )}
          {rules.booking_approve_all && <p className="note">予約は、お店が確認してから確定します。確定したらLINEでお知らせします。</p>}
          {notices.length > 0 && (
            <div className="alert info bk-vaccine">
              {notices.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          )}
          <ActionBar>
            <PressButton type="button" className="btn" disabled={dogIds.length === 0} onClick={() => go(1)}>
              日にちを選ぶ
            </PressButton>
          </ActionBar>
        </>
      )}

      {step === 1 && (
        <>
          <div className="page-head">
            <h2>{service === 'daycare' ? '日にちと時刻' : 'お泊まりの日にち'}</h2>
            <p className="lead">
              {service === 'daycare'
                ? '預ける日を選び、預ける時刻とお迎えの時刻を選んでください。'
                : start && !end
                  ? 'チェックアウトの日を選んでください。'
                  : 'チェックインの日を選んでください。'}
            </p>
          </div>
          <BookingCalendar
            service={service}
            dogIds={dogIds}
            first={win.first}
            last={win.last}
            maxNights={rules.booking_window.max_nights}
            start={start}
            end={end}
            onChange={(s, e) => {
              setStart(s);
              setEnd(e);
            }}
          />
          {datesReady && (
            <div className="row2">
              <div className="field">
                <label htmlFor={startId}>{service === 'daycare' ? '預ける時刻' : 'チェックインの時刻'}</label>
                <select id={startId} value={startTime} onChange={(e) => setStartTime(e.target.value)}>
                  {times.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/^0/, '')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={endId}>{service === 'daycare' ? 'お迎えの時刻' : 'チェックアウトの時刻'}</label>
                <select id={endId} value={endTime} onChange={(e) => setEndTime(e.target.value)}>
                  {times.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/^0/, '')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {datesReady && <p className="bk-when">{bookingWhenText(input)}</p>}
          {timeProblem && <p className="err">{timeProblem}</p>}
          <p className="note">
            受付の時間は {rules.booking_hours.open.replace(/^0/, '')}〜{rules.booking_hours.close.replace(/^0/, '')} です。
          </p>
          <button type="button" className="btn ghost" onClick={() => go(0)}>
            ワンちゃんを選び直す
          </button>
          <ActionBar>
            <PressButton type="button" className="btn" disabled={!datesReady || !!timeProblem} onClick={() => go(2)}>
              次へ
            </PressButton>
          </ActionBar>
        </>
      )}

      {step === 2 && (
        <>
          <div className="page-head">
            <h2>お店へのメモ</h2>
            <p className="lead">ごはん・お薬・体調など、お店に知らせたいことがあれば書いてください。</p>
          </div>
          <div className="field">
            <label htmlFor={noteId}>お店へのメモ</label>
            <textarea
              id={noteId}
              className="bk-note"
              rows={4}
              maxLength={500}
              value={note}
              placeholder="例: ごはんは朝と夕方に1回ずつ。お薬を1日1回。"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {rules.booking_checklist.length > 0 && (
            <fieldset className="field bk-check">
              <legend className="label">予約の前に確かめてください{rules.booking_checklist_required ? <span className="req">すべてに印</span> : null}</legend>
              {rules.booking_checklist.map((item) => (
                <label key={item} className="check">
                  <input
                    type="checkbox"
                    checked={checked.includes(item)}
                    onChange={(e) => setChecked((xs) => (e.target.checked ? [...xs, item] : xs.filter((x) => x !== item)))}
                  />
                  {item}
                </label>
              ))}
            </fieldset>
          )}
          <button type="button" className="btn ghost" onClick={() => go(1)}>
            日にちに戻る
          </button>
          <ActionBar>
            <PressButton type="button" className="btn" disabled={!checklistOk} onClick={() => go(3)}>
              内容を確かめる
            </PressButton>
          </ActionBar>
        </>
      )}

      {step === 3 && estimate && (
        <>
          <div className="page-head">
            <h2>内容を確かめる</h2>
            <p className="lead">
              {firstTimers.length > 0 || rules.booking_approve_all
                ? '「予約する」を押すと、お店に届きます。お店が確認してから確定し、LINEでお知らせします。'
                : '「予約する」を押すと、予約が確定します。'}
            </p>
          </div>
          <dl className="bk-summary rows">
            <div>
              <dt>種類</dt>
              <dd>{BOOKING_SERVICE_LABELS[service]}</dd>
            </div>
            <div>
              <dt>日にち</dt>
              <dd>{bookingWhenText(input)}</dd>
            </div>
            <div>
              <dt>ワンちゃん</dt>
              <dd>{picked.map((d) => d.name).join('・')}</dd>
            </div>
            {note.trim() && (
              <div>
                <dt>お店へのメモ</dt>
                <dd className="bk-pre">{note.trim()}</dd>
              </div>
            )}
          </dl>
          <EstimateBlock estimate={estimate} />
          <p className="note">キャンセルは、利用の{rules.booking_cancel_deadline.days_before === 0 ? '当日' : `${rules.booking_cancel_deadline.days_before}日前`}の {rules.booking_cancel_deadline.time.replace(/^0/, '')} まで、予約の一覧からできます。予約を変えるときは、キャンセルしてから入れ直してください。</p>
          {error ? <ErrorNotice error={error} /> : null}
          {error instanceof ApiError && (error.code === 'booking_full' || error.code === 'booking_closed') ? (
            <button type="button" className="btn sub" onClick={backToDates}>
              日にちを選び直す
            </button>
          ) : (
            <button type="button" className="btn ghost" onClick={() => go(2)}>
              メモに戻る
            </button>
          )}
          <ActionBar>
            <PressButton type="button" className="btn" disabled={busy} onClick={submit}>
              <BusyLabel busy={busy} busyText="予約しています…">
                予約する
              </BusyLabel>
            </PressButton>
          </ActionBar>
        </>
      )}
    </main>
  );
}

function scrollTop() {
  try {
    globalThis.scrollTo?.({ top: 0 });
  } catch {
    // 動かせなくてもよい
  }
}
