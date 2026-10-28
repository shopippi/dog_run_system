import { PageHead } from '../components/PageHead';

/** 使い方・困ったとき(A-16)。この枠はこれから実装する */
export function HelpPage() {
  return (
    <div className="page">
      <PageHead title="使い方・困ったとき" howto="この画面は準備中です。" />
      <div className="panel">
        <p className="empty">この画面は準備中です。メニューから別の画面を選んでください。</p>
      </div>
    </div>
  );
}
