import type { OldCardResponse } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, postJson } from '../lib/api';

/**
 * 前のカード(LINEのショップカード・紙のカード)からの引き継ぎ(16章)。会員証の案内と、来場履歴の「引き継ぎ」の記録に使う。
 * 取れなかったときは何も出さずに進める(会員証の利用を止めない)。
 */
export function useOldCard() {
  const [data, setData] = useState<OldCardResponse | null>(null);
  useEffect(() => {
    api<OldCardResponse>('/api/me/oldcard')
      .then(setData)
      .catch(() => setData(null));
  }, []);
  const close = useCallback(() => {
    setData((d) => (d ? { ...d, notice: null } : d));
    void postJson('/api/me/oldcard/close', {}).catch(() => undefined);
  }, []);
  return { notice: data?.notice ?? null, transfers: data?.transfers ?? [], close };
}
