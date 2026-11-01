import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { adminApi } from '../lib/api';

// 確認待ちの予約の数(サイドバーの印。A-19)。画面を移るたびと、1分ごとに読み直す。
// 確認待ちの画面で承認・お断りしたときは、その画面から数を知らせる(publishPendingBookings)

const listeners = new Set<(n: number) => void>();
let last = 0;

export function publishPendingBookings(n: number) {
  last = n;
  for (const l of listeners) l(n);
}

export function usePendingBookings(enabled: boolean): number {
  const [n, setN] = useState(last);
  const { pathname } = useLocation();
  useEffect(() => {
    listeners.add(setN);
    return () => {
      listeners.delete(setN);
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      adminApi<{ count: number }>('/bookings/pending-count')
        .then((r) => alive && publishPendingBookings(r.count))
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [enabled, pathname]);
  return n;
}
