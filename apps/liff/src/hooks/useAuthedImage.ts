import { useEffect, useState } from 'react';
import { getIdToken } from '../lib/liff';

const cache = new Map<string, Promise<string | null>>();

/**
 * 認証つきの API から写真を読み、画面で使える URL にする。
 * 写真は誰でも開ける URL にしていないため、<img src> に直接は書けない(6.2)。
 */
export function useAuthedImage(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let alive = true;
    let p = cache.get(url);
    if (!p) {
      p = fetch(url, { headers: { authorization: `Bearer ${getIdToken()}` } })
        .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
        .catch(() => null);
      cache.set(url, p);
      void p.then((v) => {
        if (!v) cache.delete(url);
      });
    }
    void p.then((v) => {
      if (alive) setSrc(v);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return src;
}
