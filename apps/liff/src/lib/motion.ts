import type { Transition } from 'motion/react';

// 画面の動きの共通の値(docs/design.md 11.6)。動きは Motion(旧 framer-motion)で付ける。
// やりすぎない: 150〜350ms、跳ねすぎない(バネの damping は高め)。
// 動きを減らす設定(prefers-reduced-motion)では動かさない。各部品で useReducedMotion() を見て、最初から終わった形で出す。

/** iOS らしいバネ。速く止まり、ほとんど跳ねない */
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 1 };
/** シートのように大きな面を動かすバネ(少しゆったり、跳ねない) */
export const sheetSpring: Transition = { type: 'spring', stiffness: 380, damping: 38, mass: 1 };
/** 消えるときは、跳ねずに素早く */
export const exitTween: Transition = { type: 'tween', duration: 0.2, ease: [0.4, 0, 1, 1] };
/** ふわっと出る(画面の切り替え・会員証の出だし) */
export const easeOut: Transition = { type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] };

/** 下から少しだけ浮かんで出る */
export const riseIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: easeOut,
} as const;

/** 主ボタンを押したときに少し縮む */
export const pressPrimary = { scale: 0.97 } as const;
/** カード(選べる行など)を押したときに少し縮む */
export const pressCard = { scale: 0.98 } as const;

/** 端末が対応していれば、軽く震わせる(LINE の中の iPhone では効かないが、害はない) */
export function tapticPon() {
  try {
    navigator.vibrate?.(12);
  } catch {
    // 震わせられなくても、表示はそのまま
  }
}
