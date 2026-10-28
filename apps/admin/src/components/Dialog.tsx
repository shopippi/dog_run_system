import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 確認のダイアログ(docs/design.md 4章)。ブラウザの dialog を使い、開いている間はほかを押せない。
 * Esc キーで閉じる。開いたときは data-autofocus を付けたボタン(安全な方)にフォーカスを置き、
 * 閉じたら開く前にフォーカスがあった要素へ戻す。
 */
export function Dialog({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      d.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-foot">{footer}</div>
    </dialog>,
    document.body,
  );
}
