import { useEffect, useState } from 'react';
import { isApiUrl } from '../lib/demo-fetch';

const isDemo = import.meta.env.VITE_DEMO === '1';
const cache = new Map<string, Promise<string | null>>();

/**
 * 写真(犬の写真・旧カードの写真)の URL を、<img src> に入れられる形にする。
 * ふだんは API の URL のまま(ログインのクッキーで読む)。
 * デモ(VITE_DEMO=1)では API が親の画面の中で動くため、<img src> に API の URL を書くと読めない。
 * そのときは fetch(デモでは親の画面に送られる)で読み、画面の中だけで使える URL(blob:)にする。
 * 読み込み中は null を返す。お客さん向けの useAuthedImage と同じ扱い。
 */
export function usePhotoSrc(url: string | null | undefined): string | null {
  const viaFetch = isDemo && !!url && isApiUrl(url);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!viaFetch || !url) {
      setSrc(null);
      return;
    }
    let alive = true;
    let p = cache.get(url);
    if (!p) {
      p = fetch(url)
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
  }, [url, viaFetch]);
  if (!url) return null;
  return viaFetch ? src : url;
}
