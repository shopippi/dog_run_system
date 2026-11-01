import { useEffect, useState } from 'react';
import { getIdToken } from '../lib/liff';

const cache = new Map<string, Promise<string | null>>();

/** 写真を読む。届かなければ1回だけ読み直す。読めなければ null(写真のない子の絵を出す) */
async function loadImage(url: string): Promise<string | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${getIdToken()}` } });
      if (res.ok) return URL.createObjectURL(await res.blob());
      if (res.status < 500) return null;
    } catch {
      // 電波が弱い。少し待って読み直す
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

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
      // 写真はスマホの中に長く保存される(private・immutable)。2回目からは通信しない
      p = loadImage(url);
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
