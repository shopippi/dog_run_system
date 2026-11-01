import { PhotoSalesFrame } from './PhotoSalesFrame';

// PA-1 ダッシュボード(段階1-D)。今月の売上・枚数、販売終了が近いアルバム、最新の注文。GET /admin/api/photos/dashboard
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function PhotoDashboardPage() {
  return <PhotoSalesFrame title="写真販売" howto="今月の売上と、販売終了が近いアルバム、新しい注文を見られます。" />;
}
