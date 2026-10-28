import type { MemberCard, TicketExchangeResult, TicketUseDetail } from '@dr/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { postJson } from '../../lib/api';

type Confirm = { kind: 'exchange'; opId: string } | { kind: 'use'; id: number } | null;

const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, '/');

/** 二重に送られても同じ交換を1回にするための印(API の opId) */
function newOpId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * 会員証(L-07)の無料券の欄(C-06、8章)。
 * - ポイントが無料券1枚分以上あるとき「無料券と交換する」(確認つき)
 * - 未使用の券ごとに「使用する」(確認つき)。使うと「無料券を使用しました」の画面に進む
 */
export function TicketPanel({ card, onChanged }: { card: MemberCard; onChanged: () => Promise<void> | void }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [exchanged, setExchanged] = useState(false);
  const canExchange = card.balance >= card.pointsPerTicket;
  const count = card.tickets.length;

  if (!canExchange && count === 0 && !card.todayUsedTicketId) return null;

  const exchange = async (opId: string) => {
    setBusy(true);
    setError(null);
    try {
      await postJson<TicketExchangeResult>('/api/tickets/exchange', { opId });
      setConfirm(null);
      setExchanged(true);
      await onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const use = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<TicketUseDetail>(`/api/tickets/${id}/use`, {});
      navigate(`/tickets/${r.ticketId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
      setConfirm(null);
      await onChanged();
    }
  };

  return (
    <section className="section tk-section" aria-labelledby="tk-title">
      <div className="tk-head">
        <h3 className="section-title" id="tk-title">
          無料券
        </h3>
        <span className="tk-count">未使用 {count}枚</span>
      </div>

      {exchanged && (
        <p className="tk-done" role="status">
          無料券と交換しました。
        </p>
      )}

      {canExchange &&
        (confirm?.kind === 'exchange' ? (
          <div className="confirm-inline tk-confirm" role="group" aria-label="無料券との交換の確認">
            <p>
              <b>{card.pointsPerTicket}ポイントを無料券1枚と交換します。</b>
            </p>
            <p className="sub-text">
              いま{card.balance}ポイント → 交換したあと{card.balance - card.pointsPerTicket}ポイント
            </p>
            <div className="actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void exchange(confirm.opId)}>
                {busy ? '交換しています…' : '交換する'}
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm(null)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={busy || confirm !== null}
            onClick={() => {
              setExchanged(false);
              setError(null);
              setConfirm({ kind: 'exchange', opId: newOpId() });
            }}
          >
            無料券と交換する({card.pointsPerTicket}ポイント)
          </button>
        ))}

      {count > 0 && (
        <ul className="rows tk-list" aria-label="未使用の無料券">
          {card.tickets.map((t) => (
            <li key={t.id} className="tk-row">
              {confirm?.kind === 'use' && confirm.id === t.id ? (
                <div className="confirm-inline tk-confirm" role="group" aria-label="無料券の使用の確認">
                  <p>
                    <b>受付で見せながら押してください。</b>使用すると元に戻せません。
                  </p>
                  <div className="actions">
                    <button type="button" className="btn" disabled={busy} onClick={() => void use(t.id)}>
                      {busy ? '使用しています…' : '使用する'}
                    </button>
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm(null)}>
                      やめる
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="tk-body">
                    <b>無料券(来場1回分)</b>
                    <span className="sub-text">
                      <span className="cu-nowrap">{ymd(t.issuedAt)}に交換</span>
                      <span className="cu-nowrap">・{t.expiresAt ? `期限 ${ymd(t.expiresAt)}` : '期限なし'}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn sub tk-use"
                    disabled={busy || confirm !== null}
                    onClick={() => {
                      setExchanged(false);
                      setError(null);
                      setConfirm({ kind: 'use', id: t.id });
                    }}
                  >
                    使用する
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {error ? <ErrorNotice error={error} /> : null}

      {card.todayUsedTicketId && (
        <Link to={`/tickets/${card.todayUsedTicketId}`} className="cu-link tk-today">
          今日使った無料券の画面を見る
        </Link>
      )}
    </section>
  );
}
