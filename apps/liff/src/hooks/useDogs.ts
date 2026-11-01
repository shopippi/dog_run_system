import type { DogSummary, DogsResponse, DogVisitRecord } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/** おうちのワンちゃんと、その子ごとの来場の記録 */
export function useDogs() {
  const [dogs, setDogs] = useState<DogSummary[] | null>(null);
  const [records, setRecords] = useState<DogVisitRecord[]>([]);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => {
    setError(null);
    api<DogsResponse>('/api/dogs')
      .then((r) => {
        setDogs(r.dogs);
        setRecords(r.records ?? []);
      })
      .catch(setError);
  }, []);
  useEffect(reload, [reload]);
  return { dogs, records, error, reload };
}
