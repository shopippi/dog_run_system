import type { PhotoConfigResponse } from '@dr/shared';

// PU-7 購入した写真(段階1-D)。アルバム別、透かしなしの中サイズ、原本のダウンロード(5分の URL)、まとめて ZIP。GET /api/photos/purchases
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function PurchasedPage(_props: { config: PhotoConfigResponse }) {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>購入した写真</h2>
        <p className="lead">購入した写真は、いつでもここからダウンロードできます。</p>
      </div>
    </main>
  );
}
