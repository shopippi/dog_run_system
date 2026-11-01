import { PhotoSalesFrame } from './PhotoSalesFrame';

// PA-6 注文(段階1-C)。注文の一覧・内容、返金(7日以内・ダウンロード前。条件の外は理由を書いて)、ダウンロードの記録。GET /admin/api/photos/orders
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function PhotoOrdersPage() {
  return <PhotoSalesFrame title="注文" howto="お客さんの注文を見られます。返金は、購入から7日以内で、まだダウンロードしていない写真だけです。" />;
}
