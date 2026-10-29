import { useEffect, useRef } from 'react';
import { ApiError } from '../lib/api';

/** 出たときに見える場所までスクロールする(下に固定した帯で押したときも、何が起きたかが見えるように) */
function useRevealOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  return ref;
}

/** エラーを「何が起きたか」と「次にどうするか」の形で出す。 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const ref = useRevealOnMount<HTMLDivElement>();
  const message =
    error instanceof ApiError
      ? error.message
      : 'うまく表示できませんでした。画面を閉じて、もう一度開いてください。';
  return (
    <div ref={ref} className="alert danger" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn sub" onClick={onRetry}>
          もう一度読み込む
        </button>
      )}
    </div>
  );
}

/** 入力の足りないところを知らせる */
export function MessageNotice({ message }: { message: string }) {
  const ref = useRevealOnMount<HTMLDivElement>();
  return (
    <div ref={ref} className="alert danger" role="alert">
      <p>{message}</p>
    </div>
  );
}
