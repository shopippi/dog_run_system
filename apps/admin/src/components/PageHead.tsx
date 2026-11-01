import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** 道しるべの1つ。to があればリンク、なければ今の画面 */
export type Crumb = { label: ReactNode; to?: string; onClick?: () => void };

/**
 * ページの頭。タイトルと、3行以内の使い方(要件定義書 15.1)。右に操作を置ける。
 * 下の階層の画面では、上に道しるべ(「おうちを探す › こむぎ・だいずのおうち」)を出す(docs/design.md 11.4)。
 */
export function PageHead({
  title,
  sub,
  howto,
  aside,
  crumbs,
}: {
  title: string;
  sub?: string;
  howto: string;
  aside?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        {crumbs && crumbs.length > 0 && <Crumbs items={crumbs} />}
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

function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="いまいる場所">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {c.to && !last ? (
                <Link to={c.to} onClick={c.onClick}>
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{c.label}</span>
              )}
              {!last && (
                <span className="crumbs-sep" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
