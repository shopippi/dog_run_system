import type { MergeNotice } from '@dr/shared';
import { useEffect, useState } from 'react';
import { api, postJson } from '../lib/api';

/**
 * 「おうちが一つになりました」のお知らせ(C-12)。ほかの家族が招待からおうちをまとめたあと、次に開いたときに1回だけ出す。
 * 取れなかったときは出さずに進める(会員証の利用を止めない)。
 */
export function useMergeNotice() {
  const [notice, setNotice] = useState<MergeNotice | null>(null);
  useEffect(() => {
    api<{ notice: MergeNotice | null }>('/api/merge-notice')
      .then((r) => setNotice(r.notice))
      .catch(() => setNotice(null));
  }, []);
  const dismiss = () => {
    setNotice(null);
    void postJson('/api/merge-notice/seen', {}).catch(() => undefined);
  };
  return { notice, dismiss };
}
