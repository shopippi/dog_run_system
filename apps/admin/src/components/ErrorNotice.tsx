import { ApiError } from '../lib/api';

/** エラーを「何が起きたか」と「次にどうするか」の形で出す(15.1) */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError
      ? error.message
      : 'うまく表示できませんでした。画面を読み込み直してください。続くときは「困ったとき」の連絡先に知らせてください。';
  return (
    <div className="notice bad" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn sub small" onClick={onRetry}>
          もう一度読み込む
        </button>
      )}
    </div>
  );
}
