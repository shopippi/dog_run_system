import { useCallback, useEffect, useRef, useState } from 'react';

/** 一定の間隔で読み込み直す(今日の来場は30秒ごと。S-02) */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, intervalMs);
    return () => clearInterval(t);
  }, [reload, intervalMs]);

  return { data, error, reload };
}
