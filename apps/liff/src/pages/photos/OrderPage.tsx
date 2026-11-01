import type { PhotoConfigResponse } from '@dr/shared';

// PU-6 購入完了(段階1-C)。GET /api/photos/orders/:id。Webhook を待つ間は「処理中」(少し待って読み直す)。確定したら「購入した写真」へ
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function OrderPage(_props: { config: PhotoConfigResponse }) {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>ご購入ありがとうございます</h2>
      </div>
    </main>
  );
}
