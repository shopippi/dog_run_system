import { STAFF_ROLE_LABELS } from '@dr/shared';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Icon } from './Icon';

/**
 * 管理画面の枠。幅 960px 以上では左にサイドバー、それより狭いと上にバーとメニュー(docs/design.md 6章)。
 * 製作者のアカウントでは、本文の上に「見るだけ」の案内を出す。
 */
export function Layout({ children }: { children: ReactNode }) {
  const { staff, logout, readOnly } = useAuth();
  return (
    <div className="shell">
      <aside className="side">
        <p className="side-brand">ドッグラン 受付・管理</p>
        <nav className="nav" aria-label="メニュー">
          <NavLink to="/" end>
            <Icon name="calendar" />
            <span>今日の来場</span>
          </NavLink>
          {!readOnly && (
            <NavLink to="/proxy">
              <Icon name="clipboard" />
              <span>代理チェックイン</span>
            </NavLink>
          )}
          <NavLink to="/search">
            <Icon name="users" />
            <span>おうちを探す</span>
          </NavLink>
        </nav>
        <div className="side-foot">
          <p className="who">
            <b>{staff?.name}</b>
            <span>({staff ? STAFF_ROLE_LABELS[staff.role] : ''})</span>
          </p>
          <button type="button" className="btn ghost" onClick={() => void logout()}>
            <Icon name="log-out" />
            ログアウト
          </button>
        </div>
      </aside>
      <main className="content">
        {readOnly && (
          <div className="alert info">
            <p>製作者のアカウントは見るだけです。変更のボタンは押せません。</p>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
