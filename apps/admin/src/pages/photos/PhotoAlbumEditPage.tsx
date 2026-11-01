import { PhotoSalesFrame } from './PhotoSalesFrame';

// PA-4 アルバム編集(段階1-A)。名前・種類・開催日・価格表・販売期間、写真のグリッド(複数選択 → 価格を変える・非公開・移す・外す)、公開ボタン。GET / PATCH /admin/api/photos/albums/:id
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function PhotoAlbumEditPage() {
  return <PhotoSalesFrame title="アルバムの編集" howto="写真を選んで、価格を変えたり、非公開にしたりできます。「公開する」でお客さんに見えるようになります。" />;
}
