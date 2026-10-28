import type { DogSummary } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export function useDogs() {
  const [dogs, setDogs] = useState<DogSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => {
    setError(null);
    api<{ dogs: DogSummary[] }>('/api/dogs')
      .then((r) => setDogs(r.dogs))
      .catch(setError);
  }, []);
  useEffect(reload, [reload]);
  return { dogs, error, reload };
}
