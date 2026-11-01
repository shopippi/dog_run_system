import type { MemberCard } from '@dr/shared';
import { m } from 'motion/react';
import { PawMark, PawStamps, useStampPlan } from '../../components/PawStamp';
import { RollingNumber } from '../../components/RollingNumber';
import { easeOut } from '../../lib/motion';
import { ExchangeControl } from './TicketPanel';

/**
 * 会員証の下の「スタンプ」のパネル(C-06、docs/design.md 5章・11.6)。
 * 肉球のスタンプ、右上に「3 / 10」、下に「あと○ポイントで無料券と交換できます」。
 * 1 枚分たまっていれば、主ボタン「無料券と交換する」。
 * 開いたときはスタンプを「ポポポン」と押していき、新しく付いた 1 個を押した瞬間にパネルがわずかに沈む。
 * 10 個たまっていれば、骨を押したあとに「無料券と交換できます」が下からふわっと出る。
 */
export function StampPanel({
  card,
  memberNo,
  onChanged,
  still = false,
}: {
  card: MemberCard;
  memberNo: string;
  onChanged: () => Promise<void> | void;
  /** 前に開いたときの内容を出しているあいだ(動かさない。15.3) */
  still?: boolean;
}) {
  const canExchange = card.balance >= card.pointsPerTicket;
  const { plan, layout, done } = useStampPlan({
    balance: card.balance,
    perTicket: card.pointsPerTicket,
    owner: memberNo,
    todayPoints: card.todayPoints ?? 0,
    still,
  });
  const dip = plan.pressAt !== null;
  const textAfterBone = canExchange && plan.boneAt !== null;
  return (
    <m.section
      className="stamp-panel"
      aria-labelledby="stamp-title"
      // 新しく付いた 1 個を押した瞬間に、カードがわずかに沈む(1px)
      animate={dip ? { y: [0, 1, 0] } : undefined}
      transition={dip ? { delay: plan.pressAt! / 1000, duration: 0.24, times: [0, 0.3, 1], ease: 'easeOut' } : undefined}
    >
      <div className="stamp-head">
        <h3 className="section-title" id="stamp-title">
          スタンプ
        </h3>
        <span className="stamp-count mono">
          <RollingNumber value={card.balance} /> / {card.pointsPerTicket}
        </span>
      </div>
      <PawStamps perTicket={card.pointsPerTicket} plan={plan} layout={layout} done={done} />
      {textAfterBone ? (
        <m.p
          className="stamp-text"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...easeOut, duration: 0.28, delay: (plan.boneAt! + 40) / 1000 }}
        >
          無料券と交換できます
        </m.p>
      ) : (
        <p className="stamp-text">
          {canExchange ? '無料券と交換できます' : `あと${card.toNextTicket}ポイントで無料券と交換できます`}
        </p>
      )}
      {layout.today.length > 0 ? (
        // 凡例: 朱肉の色の肉球は、今日の来場で付いたスタンプ
        <p className="stamp-legend">
          <PawMark size={14} className="stamp-legend-mark" />
          今日のスタンプ
        </p>
      ) : null}
      <ExchangeControl card={card} onChanged={onChanged} />
    </m.section>
  );
}
