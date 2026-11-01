import { PhotoSalesFrame } from './PhotoSalesFrame';

// PA-5 価格表(段階1-A)。価格表を作る・変える、種類ごとの既定。GET /admin/api/photos/price-lists
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function PhotoPriceListsPage() {
  return <PhotoSalesFrame title="価格表" howto="1枚の価格と、アルバムまるごとの価格を決めます。変えると、その価格表を使うアルバムにすぐ反映します。" />;
}
