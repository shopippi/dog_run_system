import type { ReactNode } from 'react';

/**
 * ボタンを押したあとの待ち(docs/design.md 11.1)。ボタンの中に小さな回る印と「保存しています…」を出す。
 * ふだんの文字と待ちの文字を同じ場所に重ねて置き、見えない方も幅を取るので、ボタンの幅は変わらない。
 */
export function BusyLabel({ busy, pending, children }: { busy: boolean; pending: string; children: ReactNode }) {
  return (
    <span className="busy-swap" data-busy={busy || undefined}>
      <span className="busy-idle" aria-hidden={busy || undefined}>
        {children}
      </span>
      <span className="busy-pending" aria-hidden={!busy || undefined}>
        <span className="spin" aria-hidden="true" />
        {pending}
      </span>
    </span>
  );
}
