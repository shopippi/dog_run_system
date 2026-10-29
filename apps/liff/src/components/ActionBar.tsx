import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * フォームの主ボタンを置く、画面の下に固定した帯(docs/design.md 11.3)。すりガラス、上に 1px の線、safe-area の余白。
 * 入力の途中でもいつでも押せる。帯の高さを --action-bar-h に入れ、ページの下に同じだけ余白を足して、
 * 最後の入力欄が帯に隠れないようにする(styles.css の .has-action-bar)。
 */
export function ActionBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--action-bar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    root.classList.add('has-action-bar');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.classList.remove('has-action-bar');
      root.style.removeProperty('--action-bar-h');
    };
  }, []);
  return createPortal(
    <div ref={ref} className="action-bar">
      <div className="action-bar-inner">{children}</div>
    </div>,
    document.body,
  );
}
