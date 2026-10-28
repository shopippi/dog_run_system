import { MANUAL_POINT_REASONS, type HouseholdDetail, type ManualPointReason, type ManualPointsPreview } from '@dr/shared';
import { useEffect, useState } from 'react';
import { adminPost } from '../lib/api';
import { Dialog } from './Dialog';
import { ErrorNotice } from './ErrorNotice';
import { Icon } from './Icon';

/**
 * ポイント・無料券の手動登録(A-03)。入力 → 結果のプレビュー → 確定、の2段階で進める(15.1)。
 */
export function ManualPointsDialog({
  d,
  onClose,
  onDone,
}: {
  d: HouseholdDetail;
  onClose: () => void;
  onDone: (result: ManualPointsPreview) => void;
}) {
  const [points, setPoints] = useState(0);
  const [tickets, setTickets] = useState(0);
  const [reason, setReason] = useState<ManualPointReason | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<ManualPointsPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const body = { points, tickets, reason, note };
  const ready = (points !== 0 || tickets !== 0) && reason !== null && (reason !== 'その他' || note.trim() !== '');

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await adminPost<ManualPointsPreview>(`/households/${d.id}/points/preview`, body));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await adminPost<ManualPointsPreview>(`/households/${d.id}/points`, body));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  if (preview) {
    return (
      <Dialog
        title="この内容で登録しますか"
        onClose={() => !busy && onClose()}
        footer={
          <>
            <button
              type="button"
              className="btn sub"
              data-autofocus
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setError(null);
              }}
            >
              戻る
            </button>
            <button type="button" className="btn" disabled={busy} onClick={submit}>
              {busy ? '登録しています…' : '登録する'}
            </button>
          </>
        }
      >
        <p>
          <b>{d.displayName}</b>(<span className="mono">{d.memberNo}</span>)に、次のとおり登録します。
        </p>
        <dl className="mp-result" aria-label="登録したあと">
          <div>
            <dt>ポイント</dt>
            <dd>
              {preview.balanceBefore} → <b>{preview.balanceAfter}</b>
            </dd>
          </div>
          <div>
            <dt>使える無料券</dt>
            <dd>
              {preview.ticketsBefore}枚 → <b>{preview.ticketsAfter}枚</b>
            </dd>
          </div>
          <div>
            <dt>理由</dt>
            <dd>{reason === 'その他' ? `その他: ${note.trim()}` : note.trim() ? `${reason}(${note.trim()})` : reason}</dd>
          </div>
        </dl>
        {preview.ticketsIssued > 0 && (
          <p className="sub-text">
            ポイントが{preview.pointsPerTicket}たまるので、無料券を{preview.ticketsIssued}枚発行し、その分のポイントを差し引きます。
          </p>
        )}
        <p className="sub-text">登録した内容は操作ログに残り、操作ログから元に戻せます。</p>
        {error ? <ErrorNotice error={error} /> : null}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="ポイント・無料券の手動登録"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || !ready} onClick={check}>
            {busy ? '確かめています…' : '内容を確かめる'}
          </button>
        </>
      }
    >
      <p className="sub-text">
        いまは {d.balance}ポイント・使える無料券 {d.usableTickets}枚 です。減らすときは「−」を押してください。
      </p>
      <Stepper label="ポイント" unit="ポイント" value={points} min={-100} max={100} onChange={setPoints} />
      <Stepper label="無料券" unit="枚" value={tickets} min={-20} max={20} onChange={setTickets} />
      <div className="field">
        <span className="label" id="mp-reason">
          理由 <span className="req">必須</span>
        </span>
        <div className="chips" role="radiogroup" aria-labelledby="mp-reason">
          {MANUAL_POINT_REASONS.map((r) => (
            <label key={r}>
              <input type="radio" name="mp-reason" checked={reason === r} onChange={() => setReason(r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="mp-note">
          理由の内容{reason === 'その他' ? <span className="req">必須</span> : null}
        </label>
        <input id="mp-note" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder="例: 10月のハロウィン会の参加特典" />
        <span className="hint">「その他」を選んだときは、必ず入力してください。</span>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

function Stepper({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  // 入力の途中(「-」だけなど)も消さないよう、文字のまま持つ
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="field">
      <span className="label" id={`mp-${label}`}>
        {label}
      </span>
      <div className="mp-stepper" role="group" aria-labelledby={`mp-${label}`}>
        <button type="button" className="btn sub icon-btn" aria-label={`${label}を1へらす`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
          <Icon name="minus" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          aria-label={`${label}の増減`}
          value={text}
          min={min}
          max={max}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            onChange(e.target.value.trim() !== '' && Number.isFinite(n) ? clamp(Math.trunc(n)) : 0);
          }}
        />
        <button type="button" className="btn sub icon-btn" aria-label={`${label}を1ふやす`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
          <Icon name="plus" />
        </button>
        <span className="sub-text">
          {value > 0 ? `${value}${unit} 増やす` : value < 0 ? `${-value}${unit} 減らす` : '変えない'}
        </span>
      </div>
    </div>
  );
}
