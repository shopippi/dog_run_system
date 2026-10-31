import type { OldCardResponse } from '@dr/shared';

function monthDay(ymd: string) {
  return `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
}

/**
 * 会員証に出す「前のカードのポイントを引き継げます」の案内(16章)。
 * お客さんからの申請はない。受付で前のカードを見せてもらい、受付で入力する(対面だけ)。
 * 引き継いだあと・移行期間のあと・「閉じる」を押したあとは出さない(サーバーが判断する)。
 */
export function OldCardNotice({ notice, onClose }: { notice: OldCardResponse['notice']; onClose: () => void }) {
  if (!notice) return null;
  return (
    <section className="oc-notice" aria-labelledby="oc-title">
      <h3 id="oc-title">前のカードのポイントを引き継げます</h3>
      <p>
        受付で前のカード(LINEのショップカード・紙のカード)を見せてください。たまっているポイントを引き継げます。
        {notice.endDate && <span className="cu-nowrap">({monthDay(notice.endDate)}まで)</span>}
      </p>
      <button type="button" className="pf-nudge-later" onClick={onClose}>
        閉じる
      </button>
    </section>
  );
}
