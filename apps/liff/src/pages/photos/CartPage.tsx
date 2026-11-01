import type { PhotoConfigResponse } from '@dr/shared';

// PU-5 カート(段階1-C)。サーバーのカート(GET /api/photos/cart)。行ごとに外す、まるごとに含まれる写真・買えなくなった写真の印、合計(サーバーが計算)、「購入手続きへ」(POST /api/photos/checkout → Stripe Checkout へ移る)
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function CartPage(_props: { config: PhotoConfigResponse }) {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>カート</h2>
      </div>
    </main>
  );
}
