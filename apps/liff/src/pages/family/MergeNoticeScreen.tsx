import type { MergeNotice } from '@dr/shared';

/**
 * 「おうちが一つになりました」(C-12)。ほかの家族が招待からおうちをまとめたとき、まとめられた側の家族に1回だけ出す。
 */
export function MergeNoticeScreen({ notice, onDone }: { notice: MergeNotice; onDone: () => void }) {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>おうちが一つになりました</h2>
        <p className="lead">
          ご家族が、2つのおうちを一つにまとめました。これからは「{notice.householdName}」の会員証でポイントがたまります。
        </p>
      </div>
      <div className="welcome-card">
        <div className="welcome-who">
          <p className="name">{notice.householdName}</p>
        </div>
        <div className="welcome-id">
          <span className="label">新しい会員ID</span>
          <p className="id mono">{notice.memberNo}</p>
        </div>
        <div className="welcome-id">
          <span className="label">ポイント</span>
          <p className="id mg-num">
            {notice.points}
            <small>ポイント</small>
          </p>
        </div>
      </div>
      <p className="note">これまでの会員ID({notice.previousMemberNo})は使わなくなりました。</p>
      <button type="button" className="btn" onClick={onDone}>
        会員証を見る
      </button>
    </main>
  );
}
