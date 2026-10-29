import { AnimatePresence, m, useIsPresent, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { spring } from '../lib/motion';

/**
 * 数字が変わるときに、上下にスライドして切り替わる(iOS の数字の変わり方。docs/design.md 11.6)。
 * 増えたときは下から、減ったときは上から新しい数字が入る。はじめの表示と、動きを減らす設定では動かさない。
 * 入れ替わりの間、消えていく数字は読み上げない。
 */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const prev = useRef(value);
  const dir = value >= prev.current ? 1 : -1;
  prev.current = value;
  if (reduce) return <span className={className}>{value}</span>;
  return (
    <span className={`roll${className ? ` ${className}` : ''}`}>
      <AnimatePresence initial={false} custom={dir}>
        <Digit key={value} value={value} dir={dir} />
      </AnimatePresence>
    </span>
  );
}

const variants = {
  enter: (dir: number) => ({ y: `${dir * 70}%`, opacity: 0 }),
  center: { y: '0%', opacity: 1 },
  exit: (dir: number) => ({ y: `${dir * -70}%`, opacity: 0 }),
};

function Digit({ value, dir }: { value: number; dir: number }) {
  const present = useIsPresent();
  return (
    <m.span
      className="roll-item"
      aria-hidden={present ? undefined : true}
      custom={dir}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ ...spring, opacity: { duration: 0.15 } }}
    >
      {value}
    </m.span>
  );
}
