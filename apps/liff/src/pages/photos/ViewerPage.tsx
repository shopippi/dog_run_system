import type { PhotoConfigResponse } from '@dr/shared';

// PU-4 写真ビューア(段階1-B)。透かし付きのプレビュー、スワイプで前後、カートに入れる(選んだ写真をまとめても入れられる)
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function ViewerPage(_props: { config: PhotoConfigResponse }) {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>写真</h2>
      </div>
    </main>
  );
}
