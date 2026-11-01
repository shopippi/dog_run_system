import { formatPhotoPrice } from '@dr/shared';

/** 価格の表示(税込み)。数字は等幅にする */
export function Price({ yen, note }: { yen: number; note?: string }) {
  return (
    <span className="ph-price">
      {formatPhotoPrice(yen)}
      {note && <span className="ph-price-note">{note}</span>}
    </span>
  );
}
