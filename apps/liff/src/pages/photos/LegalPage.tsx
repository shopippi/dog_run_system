// 特定商取引法に基づく表記・利用規約(写真販売)・プライバシーポリシー(段階1-C)。GET /api/photos/legal(ログインなしで読める)。
// Stripe の審査には、ログインなしで開ける URL が要る: Worker の /api/photos/legal の JSON を、段階1-C が LIFF の外の HTML でも出す(docs/photo-requirements.md 9.3)。
export function LegalPage() {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>特定商取引法に基づく表記・利用規約</h2>
      </div>
    </main>
  );
}
