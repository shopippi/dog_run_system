import { ESTIMATE_NOTE, yen, type BookingEstimate } from '@dr/shared';

/** 料金の目安(合計と内訳)。「目安。お支払いは受付で」を必ず添える(21章) */
export function EstimateBlock({ estimate }: { estimate: BookingEstimate }) {
  return (
    <section className="bk-estimate" aria-label="料金の目安">
      <div className="bk-estimate-head">
        <span className="section-label">料金の目安</span>
        <b className="bk-estimate-total">{yen(estimate.total)}</b>
      </div>
      <ul className="bk-estimate-lines">
        {estimate.lines.map((l, i) => (
          <li key={`${l.dogId ?? l.dogName}-${i}`}>
            {/* 「(預かり(1日)・中型)」が途中で切れないよう、名前と内容をそれぞれまとめて折り返す */}
            <span>
              {l.dogName}
              <span className="cu-nowrap">
                ({l.label}
                {l.label.startsWith('お泊まり') ? ` × ${l.qty}泊` : ''})
              </span>
            </span>
            <span className="mono-num">{yen(l.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="note">{ESTIMATE_NOTE}</p>
    </section>
  );
}
