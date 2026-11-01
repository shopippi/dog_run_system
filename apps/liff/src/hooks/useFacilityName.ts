import { DEFAULT_SETTINGS, type FacilityResponse } from '@dr/shared';
import { useEffect, useState } from 'react';

// 施設の名前(設定 facility_name)。ログインの前でも読める API から読み、画面の中で共有する。
// 読み込むまでは初期値(グリーンドーム)を出す。

let current: string = DEFAULT_SETTINGS.facility_name;
let loading: Promise<void> | null = null;
const listeners = new Set<(name: string) => void>();

/** 施設の名前が変わったことを、開いている画面に知らせる(設定を保存したときなど) */
export function publishFacilityName(name: string) {
  current = name;
  document.title = `${name} 会員証`;
  for (const l of listeners) l(name);
}

function load(): Promise<void> {
  loading ??= fetch('/api/public-settings')
    .then(async (res) => {
      if (!res.ok) return;
      const body = (await res.json()) as FacilityResponse;
      if (body.facilityName) publishFacilityName(body.facilityName);
    })
    .catch(() => {
      // 読めなくても初期値のまま表示する
      loading = null;
    });
  return loading;
}

export function useFacilityName(): string {
  const [name, setName] = useState(current);
  useEffect(() => {
    listeners.add(setName);
    setName(current);
    void load();
    return () => {
      listeners.delete(setName);
    };
  }, []);
  return name;
}
