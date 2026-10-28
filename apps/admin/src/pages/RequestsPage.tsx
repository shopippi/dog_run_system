import { PageHead } from '../components/PageHead';

/** 確認待ち(A-05・A-08)。この枠はこれから実装する */
export function RequestsPage() {
  return (
    <div className="page">
      <PageHead title="確認待ち" howto="この画面は準備中です。" />
      <div className="panel">
        <p className="empty">この画面は準備中です。メニューから別の画面を選んでください。</p>
      </div>
    </div>
  );
}
