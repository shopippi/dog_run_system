import type { ReactNode } from 'react';

/**
 * ボタンの中の待ち(docs/design.md 11.1)。送っているあいだは、小さな回る印(16px)と「〜しています…」を出す。
 * ボタンの幅は変えない(主ボタンは幅いっぱいのため、文字が変わっても幅は同じ)。
 */
export function BusyLabel({ busy, busyText, children }: { busy: boolean; busyText: string; children: ReactNode }) {
  if (!busy) return <>{children}</>;
  return (
    <>
      <span className="spinner" aria-hidden="true" />
      {busyText}
    </>
  );
}
