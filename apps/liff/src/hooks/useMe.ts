import type { MeResponse } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/** 開いた LINE アカウントが、どのおうちの家族かを調べる(10.3)。 */
export function useMe() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMe(await api<MeResponse>('/api/me'));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { me, error, loading, reload };
}
