import { useRef, useState, type PointerEvent } from 'react';

// 写真ビューア(PU-4)の、左右のスワイプで前後の写真へ。ライブラリを使わない小さな自前の処理
// (LINE の中のブラウザでも動く pointer のイベントだけ。縦のスクロールとピンチの拡大は邪魔しない: touch-action: pan-y pinch-zoom)。
// - 横に 8px 動いたら横のスワイプと決め、指について写真が動く。端(前・次がない)ではゴムのように少しだけ
// - 64px 以上動かすか、速く払う(0.45px/ms 以上)と前後へ。それ以外は元に戻る

const LOCK_PX = 8;
const GO_PX = 64;
const GO_SPEED = 0.45;

type Start = { id: number; x: number; y: number; t: number; axis: 'x' | 'y' | null };

export function useSwipe({ onPrev, onNext }: { onPrev: (() => void) | null; onNext: (() => void) | null }) {
  const start = useRef<Start | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const end = (e: PointerEvent<HTMLElement>, cancel: boolean) => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    setDx(0);
    if (!s || s.axis !== 'x' || cancel) return;
    const d = e.clientX - s.x;
    const v = d / Math.max(1, e.timeStamp - s.t);
    if ((d <= -GO_PX || v <= -GO_SPEED) && onNext) onNext();
    else if ((d >= GO_PX || v >= GO_SPEED) && onPrev) onPrev();
  };

  return {
    dx,
    dragging,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, axis: null };
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const ddx = e.clientX - s.x;
        const ddy = e.clientY - s.y;
        if (!s.axis) {
          if (Math.abs(ddx) >= LOCK_PX && Math.abs(ddx) > Math.abs(ddy)) {
            s.axis = 'x';
            setDragging(true);
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } else if (Math.abs(ddy) >= LOCK_PX) {
            start.current = null; // 縦のスクロール
            return;
          } else return;
        }
        const blocked = (ddx > 0 && !onPrev) || (ddx < 0 && !onNext);
        setDx(blocked ? ddx / 4 : ddx);
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, false),
      onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, true),
    },
  };
}
