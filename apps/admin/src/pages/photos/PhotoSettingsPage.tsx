import { PhotoSalesFrame } from './PhotoSalesFrame';

// PA-7 設定(段階1-D)。販売する・止める、透かしの文字、販売期間、ダウンロードの上限、返金の期間、購入完了のお知らせ、特定商取引法に基づく表記・利用規約。GET / PATCH /admin/api/settings の photo_ の項目
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function PhotoSettingsPage() {
  return <PhotoSalesFrame title="写真販売の設定" howto="販売を始める・止めるや、透かしの文字、特定商取引法に基づく表記を変えられます。" />;
}
