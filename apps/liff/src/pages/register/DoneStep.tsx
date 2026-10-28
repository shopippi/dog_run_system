import type { RegisterResponse } from '@dr/shared';

/** L-04 登録完了(会員IDの表示)(C-01) */
export function DoneStep({ result, onNext }: { result: RegisterResponse; onNext: () => void }) {
  return (
    <main className="screen">
      <div className="welcome-card">
        <p>登録が完了しました</p>
        <p className="name">{result.householdName}</p>
        <p className="small">会員ID</p>
        <p className="id mono">{result.memberNo}</p>
      </div>
      <p className="small muted">
        会員IDは、ご家族で共通です。受付でたずねられたときは、この番号をお伝えください。
      </p>
      <button type="button" className="btn" onClick={onNext}>
        会員証を見る
      </button>
    </main>
  );
}
