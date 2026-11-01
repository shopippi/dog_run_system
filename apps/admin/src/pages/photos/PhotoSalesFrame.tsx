import type { PhotoAvailability } from '@dr/shared';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { PageHead } from '../../components/PageHead';
import { useLoad } from '../../hooks/useLoad';
import { adminApi } from '../../lib/api';
import './photos.css';

// 写真販売の画面の枠(段階0・統合の担当のファイル)。上のタブで PA-1〜PA-7 を切り替え、準備中の理由を出す。
// メニューは1つ(「写真販売」)だけにして、1280×800 で下のメニューが隠れないようにする。

const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: '/photos', label: 'ダッシュボード', end: true },
  { to: '/photos/upload', label: 'アップロード' },
  { to: '/photos/albums', label: 'アルバム' },
  { to: '/photos/price-lists', label: '価格表' },
  { to: '/photos/orders', label: '注文' },
  { to: '/photos/settings', label: '設定' },
];

export function PhotoSalesFrame({ title, howto, aside, children }: { title: string; howto: string; aside?: ReactNode; children?: ReactNode }) {
  const availability = useLoad(() => adminApi<PhotoAvailability>('/photos/availability'), []);
  return (
    <div className="page">
      <PageHead title={title} howto={howto} aside={aside} />
      <nav className="ph-tabs" aria-label="写真販売の画面">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      {availability.data && !availability.data.available && availability.data.message && (
        <div className="alert info" role="status">
          <p>{availability.data.message}</p>
        </div>
      )}
      {children}
    </div>
  );
}
