import type { MemberCard, TicketExchangeResult, TicketUseDetail } from '@dr/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BottomSheet } from '../../components/BottomSheet';
import { ErrorNotice } from '../../components/ErrorNotice';
import { SlideToUse } from '../../components/SlideToUse';
import { useToast } from '../../components/Toast';
import { postJson } from '../../lib/api';

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
 * - 未使用の券ごとに「スライドして使用する」(昔の iPhone のロック解除と同じ操作。うっかり押しを防ぐ)。
 *   右端まで動かすと使い、「使用できました」の画面に進む
 * - 0 枚なら「使える無料券はありません」の一文
 * 「無料券と交換する」はスタンプのパネルに置く(ExchangeControl。docs/design.md 5章)
 */
export function TicketPanel({ card, onChanged }: { card: MemberCard; onChanged: () => Promise<void> | void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const count = card.tickets.length;

  /** 使えたら「使用できました」の画面へ進む。うまくいかなければ false(つまみが左へ戻る) */
  const use = async (id: number): Promise<boolean> => {
    setError(null);
    try {
      const r = await postJson<TicketUseDetail>(`/api/tickets/${id}/use`, {});
      navigate(`/tickets/${r.ticketId}`);
      return true;
    } catch (e) {
      setError(e);
      await onChanged();
      return false;
    }
  };

  return (
    <section className="section tk-section" aria-labelledby="tk-title">
      <div className="tk-head">
        <h3 className="section-title" id="tk-title">
          無料券
        </h3>
        {count > 0 ? <span className="tk-count">未使用 {count}枚</span> : null}
      </div>

      {count === 0 && <p className="tk-empty">使える無料券はありません</p>}

      {count > 0 && (
        <>
          <p className="tk-howto">受付で見せながら、右へスライドして使います。使うと元に戻せません。</p>
          <ul className="rows tk-list" aria-label="未使用の無料券">
            {card.tickets.map((t) => (
              <li key={t.id} className="tk-row">
                <span className="tk-body">
                  <b>無料券(来場1回分)</b>
                  <span className="sub-text">
                    <span className="cu-nowrap">{ymd(t.issuedAt)}に交換</span>
                    <span className="cu-nowrap">・{t.expiresAt ? `期限 ${ymd(t.expiresAt)}` : '期限なし'}</span>
                  </span>
                </span>
                <SlideToUse label="スライドして使用する" busyLabel="使用しています…" onComplete={() => use(t.id)} />
              </li>
            ))}
          </ul>
        </>
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

/**
 * 「無料券と交換する」(C-06、8章)。ポイントが無料券1枚分以上あるときの主ボタン。下から出るシートで確認してから交換する。
 * 会員証の下のスタンプのパネルの中に置く(docs/design.md 5章)。交換できたらトーストで知らせる(11.3)。
 */
export function ExchangeControl({ card, onChanged }: { card: MemberCard; onChanged: () => Promise<void> | void }) {
  const [opId, setOpId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const canExchange = card.balance >= card.pointsPerTicket;

  const exchange = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await postJson<TicketExchangeResult>('/api/tickets/exchange', { opId: id });
      setBusy(false);
      setOpId(null);
      toast('無料券と交換しました。');
      await onChanged();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <>
      {canExchange && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setError(null);
            setOpId(newOpId());
          }}
        >
          無料券と交換する({card.pointsPerTicket}ポイント)
        </button>
      )}
      {error && !opId ? <ErrorNotice error={error} /> : null}

      <BottomSheet
        open={opId !== null}
        onClose={() => setOpId(null)}
        busy={busy}
        title="無料券と交換します"
        actions={
          <button type="button" className="btn" disabled={busy} onClick={() => opId && void exchange(opId)}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                交換しています…
              </>
            ) : (
              '交換する'
            )}
          </button>
        }
      >
        <p>
          <b>{card.pointsPerTicket}ポイントを無料券1枚と交換します。</b>
        </p>
        <p className="tk-sheet-points">
          いま{card.balance}ポイント → 交換したあと{card.balance - card.pointsPerTicket}ポイント
        </p>
        {error ? <ErrorNotice error={error} /> : null}
      </BottomSheet>
    </>
  );
}
