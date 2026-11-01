import type { PhotoConfigResponse } from '@dr/shared';

// PU-3 アルバム詳細(段階1-B)。サムネイルのグリッド(PhotoGrid)、複数選択して「カートに入れる」(POST /api/photos/cart/items にまとめて)、購入済みの印、まるごと購入、販売終了日。GET /api/photos/albums/:id
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function AlbumPage(_props: { config: PhotoConfigResponse }) {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>アルバム</h2>
        <p className="lead">写真を選んで、カートに入れられます。</p>
      </div>
    </main>
  );
}
