import type { MemberCard } from '@dr/shared';
import { PawStamps } from '../../components/PawStamp';
import { ExchangeControl } from './TicketPanel';

/**
 * 会員証の下の「スタンプ」のパネル(C-06、docs/design.md 5章)。
 * 肉球のスタンプ、右上に「3 / 10」、下に「あと○ポイントで無料券と交換できます」。
 * 1 枚分たまっていれば、主ボタン「無料券と交換する」。
 */
export function StampPanel({ card, memberNo, onChanged }: { card: MemberCard; memberNo: string; onChanged: () => Promise<void> | void }) {
  const canExchange = card.balance >= card.pointsPerTicket;
  return (
    <section className="stamp-panel" aria-labelledby="stamp-title">
      <div className="stamp-head">
        <h3 className="section-title" id="stamp-title">
          スタンプ
        </h3>
        <span className="stamp-count mono">
          {card.balance} / {card.pointsPerTicket}
        </span>
      </div>
      <PawStamps balance={card.balance} perTicket={card.pointsPerTicket} owner={memberNo} />
      <p className="stamp-text">
        {canExchange ? '無料券と交換できます' : `あと${card.toNextTicket}ポイントで無料券と交換できます`}
      </p>
      <ExchangeControl card={card} onChanged={onChanged} />
    </section>
  );
}
