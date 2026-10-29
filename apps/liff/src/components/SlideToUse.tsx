import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from './Icon';

/** つまみを右端の何割まで動かしたら「使う」とみなすか */
const THRESHOLD = 0.9;

/**
 * 右へスライドして実行する部品(昔の iPhone の「スライドでロック解除」と同じ操作。C-06 無料券の使用)。
 * - 指(またはマウス)でつまみを右端まで動かすと onComplete を呼ぶ。途中で離すと左へ戻る
 * - キーボードでは、つまみ(スライダー)にフォーカスして →(1/4 ずつ)・End で動かす。右端に着くと実行する
 * - onComplete が false を返したら(うまくいかなかったら)、つまみを左へ戻す
 */
export function SlideToUse({
  label,
  busyLabel,
  onComplete,
  disabled = false,
}: {
  /** 溝に出す文字と、スライダーの名前(例「スライドして使用する」) */
  label: string;
  /** 実行している間に出す文字 */
  busyLabel: string;
  onComplete: () => Promise<boolean>;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startP: number; max: number } | null>(null);
  const [p, setP] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [max, setMax] = useState(0);

  // つまみが動ける幅(溝の幅 − つまみの幅 − 左右の余白)
  const measure = useCallback(() => {
    const track = trackRef.current;
    const knob = knobRef.current;
    if (!track || !knob) return 0;
    const pad = knob.offsetLeft;
    const m = Math.max(0, track.clientWidth - knob.offsetWidth - pad * 2);
    setMax(m);
    return m;
  }, []);
  useEffect(() => {
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    if (ro && trackRef.current) ro.observe(trackRef.current);
    return () => ro?.disconnect();
  }, [measure]);

  const finish = useCallback(async () => {
    setP(1);
    setBusy(true);
    let ok = false;
    try {
      ok = await onComplete();
    } catch {
      ok = false;
    }
    if (!ok) {
      setBusy(false);
      setP(0);
    }
  }, [onComplete]);

  const locked = disabled || busy;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    const m = measure();
    if (m <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startP: p, max: m };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setP(Math.min(1, Math.max(0, d.startP + (e.clientX - d.startX) / d.max)));
  };
  const onPointerEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (p >= THRESHOLD) void finish();
    else setP(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(1, p + 0.25);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, p - 0.25);
    else if (e.key === 'End') next = 1;
    else if (e.key === 'Home') next = 0;
    if (next === null) return;
    e.preventDefault();
    if (next >= 1) void finish();
    else setP(next);
  };

  return (
    <div
      ref={trackRef}
      className={`slide${dragging ? ' dragging' : ''}${busy ? ' busy' : ''}`}
      aria-disabled={locked || undefined}
    >
      <span className="slide-text" aria-hidden="true" style={{ opacity: busy ? 1 : Math.max(0, 1 - p * 1.6) }}>
        {busy ? busyLabel : label}
      </span>
      <div
        ref={knobRef}
        className="slide-knob"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p * 100)}
        aria-valuetext={busy ? busyLabel : p > 0 ? `${Math.round(p * 100)}%` : '左端'}
        aria-disabled={locked || undefined}
        style={{ transform: `translateX(${p * max}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <Icon name="chevron-right" size={22} />
      </div>
    </div>
  );
}
