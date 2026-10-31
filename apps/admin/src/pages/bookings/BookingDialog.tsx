import {
  BOOKING_SERVICE_LABELS,
  DOG_SIZE_LABELS,
  bookingWhenText,
  type AdminBookingDetail,
  type AdminBookingSaved,
} from '@dr/shared';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { BusyLabel } from '../../components/BusyLabel';
import { Dialog } from '../../components/Dialog';
import { DogFace } from '../../components/DogFace';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Loading, SkeletonText } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { adminApi, adminPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatJstDateTime } from '../../components/SettingsKit';
import { BookingStatusBadge, EstimateTable } from './parts';

type Action = AdminBookingDetail['actions'][number];

const ACTION: Record<Action, { label: string; path: string; done: string }> = {
  approve: { label: '承認する', path: 'approve', done: '予約を承認しました。' },
  decline: { label: 'お断りする', path: 'decline', done: '予約をお断りしました。' },
  check_in: { label: '利用開始にする', path: 'check-in', done: '利用開始にしました。' },
  complete: { label: '利用済みにする', path: 'complete', done: '利用済みにしました。' },
  no_show: { label: '来なかった', path: 'no-show', done: '「来なかった」にしました。' },
  cancel: { label: 'キャンセルする', path: 'cancel', done: '予約をキャンセルしました。' },
};

const NOTIFY_STATUS = { sent: '送りました', skipped: '送っていません', failed: '送れませんでした' } as const;

/**
 * 予約の内容と操作(A-19・A-21)。承認・お断り(お客さんへの一言)、利用開始・利用済み・来なかった・キャンセル(理由)。
 * 変えた内容は操作ログに残り、トーストの「元に戻す」(管理者)から戻せる。
 */
export function BookingDialog({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [b, setB] = useState<AdminBookingDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<Action | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { readOnly } = useAuth();
  const toast = useToast();
  const textId = useId();

  const load = () => {
    setError(null);
    adminApi<AdminBookingDetail>(`/bookings/${id}`).then(setB).catch(setError);
  };
  useEffect(load, [id]);

  const run = async (a: Action) => {
    setBusy(true);
    setError(null);
    try {
      const body = a === 'cancel' ? { reason: text } : a === 'approve' || a === 'decline' ? { message: text || null } : {};
      const r = await adminPost<AdminBookingSaved>(`/bookings/${id}/${ACTION[a].path}`, body);
      setB(r.booking);
      setMode(null);
      setText('');
      toast({ message: ACTION[a].done, undo: { auditId: r.auditId, onUndone: () => { load(); onChanged(); } } });
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const needsText = mode === 'approve' || mode === 'decline' || mode === 'cancel';
  const textLabel = mode === 'cancel' ? 'キャンセルの理由' : 'お客さんへの一言(なくてもよい)';

  const footer = !b ? (
    <button type="button" className="btn sub" data-autofocus onClick={onClose}>
      閉じる
    </button>
  ) : mode ? (
    <>
      <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={() => { setMode(null); setText(''); setError(null); }}>
        やめる
      </button>
      <button
        type="button"
        className={mode === 'decline' || mode === 'cancel' ? 'btn danger-fill' : 'btn'}
        disabled={busy || (mode === 'cancel' && text.trim() === '')}
        onClick={() => void run(mode)}
      >
        <BusyLabel busy={busy} pending="送っています…">
          {ACTION[mode].label}
        </BusyLabel>
      </button>
    </>
  ) : (
    <>
      <button type="button" className="btn sub" data-autofocus onClick={onClose}>
        閉じる
      </button>
      {!readOnly && primaryAction(b.actions) && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            const a = primaryAction(b.actions)!;
            if (a === 'approve') setMode('approve');
            else void run(a);
          }}
        >
          {ACTION[primaryAction(b.actions)!].label}
        </button>
      )}
    </>
  );

  return (
    <Dialog title={b ? `${BOOKING_SERVICE_LABELS[b.service]}の予約` : '予約'} onClose={onClose} footer={footer}>
      {!b ? (
        error ? (
          <ErrorNotice error={error} onRetry={load} />
        ) : (
          <Loading>
            <SkeletonText size={15} lines={4} />
          </Loading>
        )
      ) : (
        <div className="bk-dlg">
          <div className="bk-dlg-head">
            <BookingStatusBadge status={b.status} />
            <span className="sub-text">{bookingWhenText(b)}</span>
          </div>
          <p className="bk-dlg-hh">
            <Link to={`/households/${b.householdId}`} onClick={onClose}>
              {b.householdName}
            </Link>{' '}
            <span className="mono sub-text">{b.memberNo}</span>
          </p>
          <ul className="bk-dlg-dogs">
            {b.dogs.map((d) => (
              <li key={d.id}>
                <DogFace name={d.name} breedName={d.breedName} url={d.thumbUrl} size={56} />
                <span>
                  <b>{d.name}</b>
                  <span className="sub-text">
                    {d.breedName}・{DOG_SIZE_LABELS[d.size]}
                    {d.firstTime ? '・はじめての預かり' : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <dl className="bk-dlg-meta">
            {b.note && (
              <div>
                <dt>お客さんのメモ</dt>
                <dd className="bk-pre">{b.note}</dd>
              </div>
            )}
            {b.checklist.length > 0 && (
              <div>
                <dt>確かめたこと</dt>
                <dd>{b.checklist.join(' / ')}</dd>
              </div>
            )}
            {b.staffNote && (
              <div>
                <dt>受付のメモ</dt>
                <dd className="bk-pre">{b.staffNote}</dd>
              </div>
            )}
            <div>
              <dt>受け付け方</dt>
              <dd>
                {b.source === 'staff' ? '受付で入力' : `LINEから(${b.requestedBy ?? '家族'}さん)`}・{formatJstDateTime(b.createdAt)}
                {b.approvalReason === 'first_time' ? '・はじめての子がいるため確認待ちに' : b.approvalReason === 'approve_all' ? '・すべて承認制のため確認待ちに' : ''}
              </dd>
            </div>
            {b.capacityOverrideReason && (
              <div>
                <dt>いっぱいの日に入れた理由</dt>
                <dd>{b.capacityOverrideReason}</dd>
              </div>
            )}
            {b.decidedAt && (b.status !== 'confirmed' || b.source === 'customer') && b.decidedBy && (
              <div>
                <dt>確認した人</dt>
                <dd>
                  {b.decidedBy}・{formatJstDateTime(b.decidedAt)}
                  {b.decisionMessage ? `「${b.decisionMessage}」` : ''}
                </dd>
              </div>
            )}
            {b.cancelledAt && (
              <div>
                <dt>キャンセル</dt>
                <dd>
                  {b.cancelledBy}・{formatJstDateTime(b.cancelledAt)}
                  {b.cancelReason ? `「${b.cancelReason}」` : ''}
                </dd>
              </div>
            )}
            {b.notifications.length > 0 && (
              <div>
                <dt>LINEのお知らせ</dt>
                <dd>
                  {b.notifications.map((n) => (
                    <span key={n.id} className="bk-notify">
                      {n.kind === 'confirmed' ? '確定' : 'お断り'}: {NOTIFY_STATUS[n.status]}
                      {n.reasonText ? `(${n.reasonText})` : ''}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          <EstimateTable estimate={b.estimate} />

          {mode && needsText && (
            <div className="field">
              <label htmlFor={textId}>{textLabel}</label>
              <textarea id={textId} className="cfg-textarea bk-dlg-text" maxLength={mode === 'cancel' ? 200 : 300} value={text} onChange={(e) => setText(e.target.value)} />
              {mode === 'decline' && <span className="hint">お断りのLINEに、この一言が入ります。</span>}
              {mode === 'approve' && <span className="hint">確定のLINEに、この一言が入ります。</span>}
            </div>
          )}
          {error ? <ErrorNotice error={error} /> : null}

          {!readOnly && !mode && b.actions.length > 0 && (
            <div className="bk-dlg-acts">
              {b.actions
                .filter((a) => a !== primaryAction(b.actions))
                .map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={a === 'cancel' || a === 'decline' ? 'btn ghost danger-text' : 'btn sub'}
                    onClick={() => (a === 'cancel' || a === 'decline' ? setMode(a) : void run(a))}
                  >
                    {ACTION[a].label}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** いちばんよく使う操作(主ボタン) */
function primaryAction(actions: Action[]): Action | null {
  for (const a of ['approve', 'check_in', 'complete'] as const) if (actions.includes(a)) return a;
  return null;
}
