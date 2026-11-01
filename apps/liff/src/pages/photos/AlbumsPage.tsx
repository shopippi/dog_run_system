import type { PhotoConfigResponse } from '@dr/shared';

// PU-2 アルバム一覧(段階1-B)。公開中のアルバム、「イベント」「日付」のタブ、年月の絞り込み、カバー写真。GET /api/photos/albums
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function AlbumsPage(_props: { config: PhotoConfigResponse }) {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>写真</h2>
        <p className="lead">イベントや日付ごとに、お店で撮った写真を見られます。</p>
      </div>
    </main>
  );
}
