import { useFacilityName } from '../hooks/useFacilityName';
import { STAFF_ROLE_LABELS } from '@dr/shared';
import { useEffect, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Icon, type IconName } from './Icon';

type Item = { to: string; label: string; icon: IconName; end?: boolean; adminOnly?: boolean; writeOnly?: boolean; badge?: boolean };
type Group = { label: string; items: Item[] };

// メニュー(要件定義書 10.2)。管理者だけの画面は adminOnly、変更の操作しかない画面は writeOnly(製作者には出さない)
const GROUPS: Group[] = [
  {
    label: '受付',
    items: [
      { to: '/', label: '今日の来場', icon: 'calendar', end: true },
      { to: '/proxy', label: '代理チェックイン', icon: 'clipboard', writeOnly: true },
      { to: '/search', label: 'おうちを探す', icon: 'users' },
    ],
  },
  {
    label: '運営',
    items: [
      { to: '/migration', label: '旧カードの引き継ぎ', icon: 'inbox', adminOnly: true },
      { to: '/merge', label: 'おうちの統合', icon: 'users', adminOnly: true },
      { to: '/dashboard', label: 'ダッシュボード', icon: 'chart' },
      { to: '/events', label: 'イベント・休業日', icon: 'flag', adminOnly: true },
    ],
  },
  {
    label: '設定',
    items: [
      { to: '/survey-questions', label: 'アンケート', icon: 'list', adminOnly: true },
      { to: '/breeds', label: '犬種', icon: 'tag', adminOnly: true },
      { to: '/settings', label: 'ルール', icon: 'sliders', adminOnly: true },
      { to: '/staff', label: 'スタッフ', icon: 'user', adminOnly: true },
    ],
  },
  {
    label: '記録',
    items: [
      { to: '/audit', label: '操作ログ', icon: 'history', adminOnly: true },
      { to: '/export', label: 'CSV出力', icon: 'download', adminOnly: true },
      { to: '/status', label: 'システムの状態', icon: 'activity', adminOnly: true },
    ],
  },
  { label: '', items: [{ to: '/help', label: '使い方・困ったとき', icon: 'help' }] },
];

/**
 * 管理画面の枠。幅 960px 以上では左にサイドバー、それより狭いと上にバーとメニュー(docs/design.md 6章)。
 * 製作者のアカウントでは、本文の上に「見るだけ」の案内を出す。
 */
export function Layout({ children }: { children: ReactNode }) {
  const { staff, logout, readOnly } = useAuth();
  const role = staff?.role ?? 'staff';
  const facilityName = useFacilityName();
  const canSee = (it: Item) => {
    if (it.adminOnly && role === 'staff') return false;
    if (it.writeOnly && readOnly) return false;
    return true;
  };
  useSlashToSearch();
  return (
    <div className="shell">
      <aside className="side">
        <p className="side-brand">{facilityName} 受付・管理</p>
        <nav className="nav" aria-label="メニュー">
          {GROUPS.map((g) => {
            const items = g.items.filter(canSee);
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={g.label || 'misc'}>
                {g.label && <p className="nav-label">{g.label}</p>}
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end}>
                    <Icon name={it.icon} />
                    <span>{it.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
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

/**
 * キーボードの「/」で、その画面の検索欄(data-search-input を付けた入力欄)にフォーカスする(docs/design.md 11.4)。
 * 入力欄にいるとき・ダイアログを開いているとき・ほかのキーと一緒に押したときは何もしない。
 */
function useSlashToSearch() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (document.querySelector('dialog[open]')) return;
      const input = [...document.querySelectorAll<HTMLInputElement>('input[data-search-input]')].find((el) => el.offsetParent !== null);
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
