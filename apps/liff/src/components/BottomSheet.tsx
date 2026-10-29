import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** 下へこれだけ引っ張ったら閉じる(px) */
const CLOSE_DISTANCE = 80;
/** 閉じる動きの長さ(CSS の --dur-slow と同じ) */
const CLOSE_MS = 240;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * 下から出るシート(docs/design.md 11.3)。確認はこのシートで行う。
 * - 上の角丸 20、上に掴みの印。背景を押す・下へ引っ張る・「やめる」・Esc で閉じる
 * - role="dialog"。開いたら「やめる」にフォーカスし、閉じたら開く前の要素に戻す
 * - 開いている間は、後ろの画面を読み上げ・操作の対象から外す(inert)
 *
 * actions には主ボタン(と必要なら危険な操作のボタン)を渡す。「やめる」はシートが付ける。
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  actions,
  cancelLabel = 'やめる',
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  cancelLabel?: string;
  /** 送っている間は閉じられないようにする */
  busy?: boolean;
}) {
  // 閉じる動きのあいだも出しておく
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    setClosing(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  if (!mounted) return null;
  return createPortal(
    <SheetBody
      onClose={onClose}
      title={title}
      actions={actions}
      cancelLabel={cancelLabel}
      busy={busy}
      closing={closing}
    >
      {children}
    </SheetBody>,
    document.body,
  );
}

function SheetBody({
  onClose,
  title,
  children,
  actions,
  cancelLabel,
  busy,
  closing,
}: {
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  cancelLabel: string;
  busy: boolean;
  closing: boolean;
}) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ startY: number; dy: number; at: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  // 開いたら「やめる」にフォーカス。閉じたら開く前の要素に戻す。後ろの画面は inert にする
  useLayoutEffect(() => {
    const root = rootRef.current;
    // 閉じる動きのあいだは、シートを操作・読み上げの対象から外す(先に外してから、フォーカスを動かす)
    if (root) root.inert = closing;
    if (closing) return;
    const before = document.activeElement as HTMLElement | null;
    const others = [...document.body.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.classList.contains('toast-region'),
    );
    const saved = others.map((el) => [el, el.inert, el.getAttribute('aria-hidden')] as const);
    for (const el of others) {
      el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus({ preventScroll: true });
    return () => {
      for (const [el, inert, hidden] of saved) {
        el.inert = inert;
        if (hidden === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', hidden);
      }
      document.body.style.overflow = overflow;
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [closing]);

  // Esc で閉じる(フォーカスがどこにあっても)
  useEffect(() => {
    if (closing) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closing, close]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // シートの中でフォーカスを回す(inert で外には出ないが、端で止まらないように)
    if (e.key !== 'Tab') return;
    const items = [
      ...(sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // 掴みの印のあたり(シートの上の部分)を下へ引っ張ると閉じる
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, dy: 0, at: performance.now() };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.dy = Math.max(0, e.clientY - d.startY);
    setDy(d.dy);
  };
  const onPointerEnd = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    const fast = d.dy > 24 && d.dy / Math.max(1, performance.now() - d.at) > 0.6;
    if (d.dy >= CLOSE_DISTANCE || fast) close();
    setDy(0);
  };

  return (
    <div
      ref={rootRef}
      className={`sheet-root${closing ? ' closing' : ''}`}
      onKeyDown={onKeyDown}
      // 閉じる動きのあいだは、もう操作・読み上げの対象にしない
      aria-hidden={closing || undefined}
    >
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={`sheet${dragging ? ' dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div
          className="sheet-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <span className="sheet-handle" aria-hidden="true" />
          <h2 className="sheet-title" id={titleId}>
            {title}
          </h2>
        </div>
        {children ? <div className="sheet-body">{children}</div> : null}
        <div className="sheet-actions">
          {actions}
          <button ref={cancelRef} type="button" className="btn ghost" disabled={busy} onClick={close}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
