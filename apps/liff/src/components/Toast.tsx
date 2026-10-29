import { AnimatePresence, m } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { exitTween, spring } from '../lib/motion';

/** トーストを出しておく時間 */
const SHOW_MS = 3000;

type Toast = { id: number; message: string };
const ToastContext = createContext<(message: string) => void>(() => {});

/** 完了・保存のお知らせを出す(「保存しました」など)。画面が切り替わっても、新しい画面の上に出る */
export const useToast = () => useContext(ToastContext);

/**
 * トースト(docs/design.md 11.3・11.6)。下からバネで出て、下へ消える小さな黒い帯・白文字。3 秒で消える。
 * role="status" で読み上げる。読み上げのために、入れ物(role="status")はいつも置いておき、中の文だけを差し替える。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);

  const show = useCallback((message: string) => {
    seq.current += 1;
    setToast({ id: seq.current, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div className="toast-region" role="status" aria-live="polite">
          <AnimatePresence mode="wait">
            {toast ? (
              <m.div
                key={toast.id}
                className="toast"
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, transition: exitTween }}
                transition={spring}
              >
                {toast.message}
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
