// まねの支払いの画面(local・test・デモだけ。PU-5 の一部、段階1-C)。
// Stripe Checkout の代わり。GET /api/photos/mock-stripe/sessions/:id で金額と明細を出し、
// 「支払う」で POST .../pay(署名つきのまねの Webhook が送られる)→ 返ってきた redirectUrl(購入完了)へ。「やめる」で .../cancel → カートへ。
// 本物ではないことを画面の上に必ず書く(「練習用の支払いの画面です。お金は動きません」)。
export function MockCheckoutPage() {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>練習用の支払いの画面</h2>
        <p className="lead">本物の支払いではありません。お金は動きません。</p>
      </div>
    </main>
  );
}
