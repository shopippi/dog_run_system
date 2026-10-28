import { useEffect, useState } from 'react';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';

/** 確認待ちの件数(管理者と製作者だけ)。メニューの印に使う。60秒ごとに読み直す */
export function usePendingCount(): number {
  const { staff } = useAuth();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!staff || staff.role === 'staff') return;
    let alive = true;
    const load = () =>
      adminApi<{ pending: number }>('/requests/count')
        .then((r) => alive && setN(r.pending))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [staff]);
  return n;
}
