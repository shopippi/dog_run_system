import type { AdminTicketUseResult, HouseholdDetail, HouseholdTicket, WithAuditId } from '@dr/shared';
import { useState } from 'react';
import { adminPost } from '../lib/api';
import { formatYmd } from '../lib/jst-format';
import { Dialog } from './Dialog';
import { BusyLabel } from './BusyLabel';
import { ErrorNotice } from './ErrorNotice';

/**
 * おうちの詳細(M-06)の「無料券を使用済みにする」(8章)。
 * お客さんがスマホを持っていないときなどに、受付で無料券を使ったことにする。確認してから使用済みにし、操作ログから元に戻せる
 */
export function TicketUseDialog({
  d,
  ticket,
  onClose,
  onDone,
}: {
  d: HouseholdDetail;
  ticket: HouseholdTicket;
  onClose: () => void;
  onDone: (r: AdminTicketUseResult & Partial<WithAuditId>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await adminPost<AdminTicketUseResult & WithAuditId>(`/households/${d.id}/tickets/${ticket.id}/use`, {}));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="無料券を使用済みにする"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy} onClick={submit}>
            <BusyLabel busy={busy} pending="使用済みにしています…">
              使用済みにする
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        <b>{d.displayName}</b>(<span className="mono">{d.memberNo}</span>)の無料券を1枚、使用済みにします。
      </p>
      <ul className="plain-list">
        <li>
          {formatYmd(ticket.issuedAt)}に{ticket.sourceLabel}の券です({ticket.expiresAt ? `${formatYmd(ticket.expiresAt)}まで` : '期限なし'})
        </li>
        <li>今日のチェックインがあれば、その来場に結びつけます。来場1回分の料金を無料にしてください</li>
        <li>使用済みにしたあと、使える無料券は {Math.max(0, d.usableTickets - 1)}枚 になります</li>
        <li>間違えたときは、操作ログから元に戻せます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
