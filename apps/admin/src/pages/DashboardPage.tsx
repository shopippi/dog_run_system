import { PageHead } from '../components/PageHead';

/** ダッシュボード(A-01)。この枠はこれから実装する */
export function DashboardPage() {
  return (
    <div className="page">
      <PageHead title="ダッシュボード" howto="この画面は準備中です。" />
      <div className="panel">
        <p className="empty">この画面は準備中です。メニューから別の画面を選んでください。</p>
      </div>
    </div>
  );
}
