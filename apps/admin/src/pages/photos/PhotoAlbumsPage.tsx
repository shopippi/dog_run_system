import { PhotoSalesFrame } from './PhotoSalesFrame';

// PA-3 アルバム一覧(段階1-A)。状態・枚数・売上・販売終了日、まとめて公開。GET /admin/api/photos/albums
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function PhotoAlbumsPage() {
  return <PhotoSalesFrame title="アルバム" howto="アルバムの状態と売上を見られます。選んで「公開する」を押すと、お客さんに見えるようになります。" />;
}
