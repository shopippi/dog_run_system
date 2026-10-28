import type { ReactNode } from 'react';

/** ページの頭。タイトルと、3行以内の使い方(要件定義書 15.1)。右に操作を置ける */
export function PageHead({
  title,
  sub,
  howto,
  aside,
}: {
  title: string;
  sub?: string;
  howto: string;
  aside?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        <h1>
          {title}
          {sub && <span className="page-sub">{sub}</span>}
        </h1>
        <p className="howto">{howto}</p>
      </div>
      {aside && <div className="page-head-aside">{aside}</div>}
    </header>
  );
}
