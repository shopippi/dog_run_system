import { AnimatePresence, m, useIsPresent, useMotionValue, useReducedMotion } from 'motion/react';
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
import { easeOut, exitTween, sheetSpring, spring } from '../lib/motion';

/** 下へこれだけ引っ張ったら閉じる(px) */
const CLOSE_DISTANCE = 80;
/** これより速く下へ払ったら、短くても閉じる(px/ms) */
const CLOSE_VELOCITY = 0.5;

/**
 * 下から出るシート(docs/design.md 11.3・11.6)。確認はこのシートで行う。
 * - 上の角丸 20、上に掴みの印。背景を押す・下へ引っ張る・「やめる」・Esc で閉じる
 * - Motion のバネで下から出て、下へ消える。背景はふわっと暗くなる
 * - 下へ引っ張ると指について動き、離したときに、遠くまで引いたか速く払ったなら閉じ、少しならバネで戻る
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
  return createPortal(
    <AnimatePresence>
      {open ? (
        <SheetBody key="sheet" onClose={onClose} title={title} actions={actions} cancelLabel={cancelLabel} busy={busy}>
          {children}
        </SheetBody>
      ) : null}
    </AnimatePresence>,
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
}: {
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  cancelLabel: string;
  busy: boolean;
}) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // 閉じる動きのあいだ(AnimatePresence が消すのを待っている間)
  const closing = !useIsPresent();
  const reduce = useReducedMotion();
  // 引っ張った量(px)。シートの中身(.sheet)だけを動かす
  const dragY = useMotionValue(0);
  const drag = useRef<{ startY: number; samples: { y: number; t: number }[] } | null>(null);
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
    if (busy || closing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY - dragY.get(), samples: [{ y: e.clientY, t: e.timeStamp }] };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.startY;
    // 上へは少しだけ(ゴムのように重く)動く
    dragY.set(raw >= 0 ? raw : -Math.min(24, Math.sqrt(-raw) * 2.4));
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
  };
  const onPointerEnd = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    const first = d.samples[0]!;
    const last = d.samples[d.samples.length - 1]!;
    const velocity = (last.y - first.y) / Math.max(1, last.t - first.t);
    const dy = dragY.get();
    if (dy >= CLOSE_DISTANCE || (dy > 16 && velocity > CLOSE_VELOCITY)) {
      close();
      return;
    }
    // 少しだけなら、バネで元の位置に戻る(下の m.div の animate が dragY を 0 へ動かす)
  };

  return (
    <div
      ref={rootRef}
      className={`sheet-root${closing ? ' closing' : ''}`}
      onKeyDown={onKeyDown}
      // 閉じる動きのあいだは、もう操作・読み上げの対象にしない
      aria-hidden={closing || undefined}
    >
      <m.div
        className="sheet-backdrop"
        onClick={close}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: exitTween }}
        transition={easeOut}
      />
      <m.div
        className="sheet-slide"
        initial={{ y: '100%' }}
        animate={{ y: '0%' }}
        exit={{ y: '100%', transition: exitTween }}
        transition={sheetSpring}
      >
        <m.div
          ref={sheetRef}
          className={`sheet${dragging ? ' dragging' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{ y: dragY }}
          animate={dragging ? undefined : { y: 0 }}
          transition={reduce ? { duration: 0 } : spring}
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
        </m.div>
      </m.div>
    </div>
  );
}
