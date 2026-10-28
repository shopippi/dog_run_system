import { STAFF_ROLE_LABELS } from '@dr/shared';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/** 管理画面の枠。上にメニュー、製作者のアカウントでは「見るだけ」の帯を出す */
export function Layout({ children }: { children: ReactNode }) {
  const { staff, logout, readOnly } = useAuth();
  return (
    <div className="console">
      <header className="con-head">
        <h1>ドッグラン 受付・管理</h1>
        <div className="who">
          <span>
            {staff?.name}({staff ? STAFF_ROLE_LABELS[staff.role] : ''})
          </span>
          <button type="button" className="btn sub small" onClick={() => void logout()}>
            ログアウト
          </button>
        </div>
      </header>
      <nav className="tabs" aria-label="メニュー">
        <NavLink to="/" end>
          今日の来場
        </NavLink>
        {!readOnly && <NavLink to="/proxy">代理チェックイン</NavLink>}
        <NavLink to="/search">おうちを探す</NavLink>
      </nav>
      {readOnly && <div className="ro-bar">製作者のアカウントは見るだけです。変更のボタンは押せません。</div>}
      {children}
    </div>
  );
}
