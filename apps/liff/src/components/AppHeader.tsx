import { Link } from 'react-router-dom';
import { Icon } from './Icon';

export type HeaderBack = { to: string; label: string };

/** 画面の上の帯。下の階層では、左に戻り先の名前を出す(docs/design.md 5章) */
export function AppHeader({ back }: { back?: HeaderBack | null }) {
  return (
    <header className="app-header">
      {back ? (
        <Link to={back.to} className="header-back">
          <Icon name="chevron-left" size={20} />
          {back.label}
        </Link>
      ) : (
        <span className="app-title">ドッグラン会員証</span>
      )}
    </header>
  );
}
