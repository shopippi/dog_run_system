import { ApiError } from '../lib/api';

/** エラーを「何が起きたか」と「次にどうするか」の形で出す。 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError
      ? error.message
      : 'うまく表示できませんでした。画面を閉じて、もう一度開いてください。';
  return (
    <div className="notice bad" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn sub" onClick={onRetry}>
          もう一度読み込む
        </button>
      )}
    </div>
  );
}
