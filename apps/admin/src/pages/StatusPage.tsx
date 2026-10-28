import { PageHead } from '../components/PageHead';

/** システムの状態(A-17・D-02)。この枠はこれから実装する */
export function StatusPage() {
  return (
    <div className="page">
      <PageHead title="システムの状態" howto="この画面は準備中です。" />
      <div className="panel">
        <p className="empty">この画面は準備中です。メニューから別の画面を選んでください。</p>
      </div>
    </div>
  );
}
