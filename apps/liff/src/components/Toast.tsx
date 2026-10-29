import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** トーストを出しておく時間 */
const SHOW_MS = 3000;
/** 消える動きの長さ */
const LEAVE_MS = 200;

type Toast = { id: number; message: string; leaving: boolean };
const ToastContext = createContext<(message: string) => void>(() => {});

/** 完了・保存のお知らせを出す(「保存しました」など)。画面が切り替わっても、新しい画面の上に出る */
export const useToast = () => useContext(ToastContext);

/**
 * トースト(docs/design.md 11.3)。下から出る小さな黒い帯・白文字。3 秒で消える。role="status" で読み上げる。
 * 読み上げのために、入れ物(role="status")はいつも置いておき、中の文だけを差し替える。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);

  const show = useCallback((message: string) => {
    seq.current += 1;
    setToast({ id: seq.current, message, leaving: false });
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (toast.leaving) {
      const t = window.setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), LEAVE_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(
      () => setToast((cur) => (cur?.id === toast.id ? { ...cur, leaving: true } : cur)),
      SHOW_MS,
    );
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div className="toast-region" role="status" aria-live="polite">
          {toast ? (
            <div key={toast.id} className={`toast${toast.leaving ? ' leaving' : ''}`}>
              {toast.message}
            </div>
          ) : null}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
