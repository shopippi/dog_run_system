import { m, type HTMLMotionProps } from 'motion/react';
import { forwardRef } from 'react';
import { pressPrimary, spring } from '../lib/motion';

/**
 * 主ボタン(docs/design.md 11.3・11.6)。押すと少し縮み(scale .97)、離すとバネで戻る。
 * 押せないときは縮まない。動きを減らす設定では縮まない(MotionConfig の reducedMotion="user")。
 */
export const PressButton = forwardRef<HTMLButtonElement, HTMLMotionProps<'button'>>(function PressButton(
  { disabled, ...rest },
  ref,
) {
  return (
    <m.button
      ref={ref}
      disabled={disabled}
      whileTap={disabled ? undefined : pressPrimary}
      transition={spring}
      {...rest}
    />
  );
});
