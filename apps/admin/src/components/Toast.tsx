import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icon } from './Icon';

// 完了のお知らせ(docs/design.md 11.4)。右下に出る黒い帯・白文字のトースト。4 秒で消える。
// 「元に戻す」ができる操作は、トーストの中の「元に戻す」で操作ログの元に戻す(POST /admin/api/audit/:id/undo)を呼ぶ。
// エラーは今までどおり画面の中に出す(トーストにしない)。

const LIFETIME = 4000;

export type ToastUndo = {
  /** 元に戻す操作ログの番号(API の応答の auditId) */
  auditId: number | null;
  /** 戻したあとのお知らせ */
  doneMessage?: string;
  /** 戻したあとに画面を読み直す */
  onUndone?: () => void;
};

export type ToastOptions = { message: string; undo?: ToastUndo };

type Item = ToastOptions & { id: number; state: 'idle' | 'undoing' | 'error'; error?: string };

const Ctx = createContext<(o: ToastOptions) => void>(() => {});

/** トーストを出す。useToast()('保存しました。') / useToast()({ message, undo }) */
export function useToast() {
  const show = useContext(Ctx);
  return useCallback((o: string | ToastOptions) => show(typeof o === 'string' ? { message: o } : o), [show]);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const { staff } = useAuth();
  // 操作ログから元に戻せるのは管理者だけ(API の権限と同じ)。ほかの人には「元に戻す」を出さない
  const canUndo = staff?.role === 'admin';

  const show = useCallback(
    (o: ToastOptions) => {
      seq.current += 1;
      const undo = canUndo && o.undo?.auditId ? o.undo : undefined;
      // 一度に出すのは 3 つまで(古いものから消す)
      setItems((prev) => [...prev, { ...o, undo, id: seq.current, state: 'idle' as const }].slice(-3));
    },
    [canUndo],
  );
  const close = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);
  const patch = useCallback((id: number, p: Partial<Item>) => setItems((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t))), []);

  const runUndo = useCallback(
    async (t: Item) => {
      if (!t.undo?.auditId) return;
      patch(t.id, { state: 'undoing' });
      try {
        await adminPost(`/audit/${t.undo.auditId}/undo`);
        close(t.id);
        show({ message: t.undo.doneMessage ?? '元に戻しました。' });
        t.undo.onUndone?.();
      } catch (e) {
        patch(t.id, {
          state: 'error',
          error: e instanceof ApiError ? e.message : '元に戻せませんでした。操作ログの画面から、もう一度お試しください。',
        });
      }
    },
    [close, patch, show],
  );

  const value = useMemo(() => show, [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-label="お知らせ">
        {items.map((t) => (
          <ToastView key={t.id} t={t} onClose={() => close(t.id)} onUndo={() => void runUndo(t)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastView({ t, onClose, onUndo }: { t: Item; onClose: () => void; onUndo: () => void }) {
  const [paused, setPaused] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 中のボタンにフォーカスがある間(キーボードで「元に戻す」を押すとき)・元に戻している間は消さない。うまく戻せなかったときは、閉じるまで残す。
  // マウスを乗せただけでは止めない(下の画面の操作を、トーストが長くふさがないように)
  const holding = paused || t.state !== 'idle';
  useEffect(() => {
    if (holding) return;
    const timer = setTimeout(() => onCloseRef.current(), LIFETIME);
    return () => clearTimeout(timer);
  }, [holding]);
  return (
    <div
      className="toast"
      role="status"
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <p className="toast-msg">{t.state === 'error' ? t.error : t.message}</p>
      {t.undo && t.state !== 'error' && (
        <button type="button" className="toast-act" disabled={t.state === 'undoing'} onClick={onUndo}>
          {t.state === 'undoing' ? '戻しています…' : '元に戻す'}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="お知らせを閉じる" onClick={onClose}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
