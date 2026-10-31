import {
  BOOKING_SERVICE_LABELS,
  BOOKING_STATUS_LABELS,
  DOG_SIZE_LABELS,
  ESTIMATE_NOTE,
  bookingWhenText,
  yen,
  type AdminBookingRow,
  type BookingEstimate,
  type BookingStatus,
  type SizeCounts,
} from '@dr/shared';
import { DogFace } from '../../components/DogFace';

/** 状態の印。色は付けない(灰色の下地)。確認待ち・確定・お預かり中は文字を濃く(docs/design.md。危険の色は使わない) */
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`badge bk-st-${status}`}>{BOOKING_STATUS_LABELS[status]}</span>;
}

/** サイズごとの「使っている数 / 受け入れ数」(小 2/5・中 0/3・大 1/2) */
export function SizeUsage({ used, caps, closed }: { used: SizeCounts; caps: SizeCounts; closed?: boolean }) {
  if (closed) return <span className="bk-usage closed">休み</span>;
  return (
    <span className="bk-usage">
      {(['small', 'medium', 'large'] as const).map((s) => (
        <span key={s} className={used[s] >= caps[s] ? 'full' : ''}>
          {DOG_SIZE_LABELS[s].slice(0, 1)} {used[s]}/{caps[s]}
        </span>
      ))}
    </span>
  );
}

/** 予約の一覧の1行(日のパネル・確認待ち)。押すと内容を開く */
export function BookingRowButton({ b, onOpen, showDate = true }: { b: AdminBookingRow; onOpen: (id: number) => void; showDate?: boolean }) {
  return (
    <button type="button" className="bk-adm-row" onClick={() => onOpen(b.id)} aria-label={`${b.dogs.map((d) => d.name).join('・')}(${b.householdName})の${BOOKING_SERVICE_LABELS[b.service]}の予約を開く`}>
      <span className="stack">
        {b.dogs.slice(0, 3).map((d) => (
          <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={44} />
        ))}
      </span>
      <span className="bk-adm-body">
        <b>
          {b.dogs.map((d) => `${d.name}(${d.breedName}・${DOG_SIZE_LABELS[d.size]}${d.firstTime ? '・はじめて' : ''})`).join('・')}
        </b>
        <span className="sub-text">
          {b.householdName} · <span className="mono">{b.memberNo}</span>
          {b.ownerNames.length > 0 ? ` · 飼い主 ${b.ownerNames.join('、')}さん` : ''}
          {b.source === 'staff' ? ' · 受付で入力' : ''}
        </span>
        <span className="sub-text">
          {showDate ? `${BOOKING_SERVICE_LABELS[b.service]} ${bookingWhenText(b)}` : `${b.startTime.replace(/^0/, '')}〜${b.endTime.replace(/^0/, '')}`}
        </span>
        {b.note && <span className="sub-text bk-adm-note">メモ: {b.note}</span>}
      </span>
      <span className="badges">
        <BookingStatusBadge status={b.status} />
      </span>
    </button>
  );
}

/** 料金の目安(合計と内訳)。「目安。お支払いは受付で」を添える */
export function EstimateTable({ estimate }: { estimate: BookingEstimate }) {
  return (
    <div className="bk-adm-estimate">
      <dl>
        {estimate.lines.map((l, i) => (
          <div key={i}>
            <dt>
              {l.dogName}({l.label}
              {l.label.startsWith('お泊まり') ? ` × ${l.qty}泊` : ''})
            </dt>
            <dd>{yen(l.amount)}</dd>
          </div>
        ))}
        <div className="total">
          <dt>合計</dt>
          <dd>{yen(estimate.total)}</dd>
        </div>
      </dl>
      <p className="note">{ESTIMATE_NOTE}</p>
    </div>
  );
}
