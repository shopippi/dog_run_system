import type { Breed } from '@dr/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function useBreeds() {
  const [breeds, setBreeds] = useState<Breed[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<{ breeds: Breed[] }>('/api/breeds')
      .then((r) => setBreeds(r.breeds))
      .catch(setError);
  }, []);
  return { breeds, error };
}
