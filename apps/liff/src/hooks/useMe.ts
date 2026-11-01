import type { MeResponse } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { clearCachedCard, loadCachedCard, saveCachedCard } from '../lib/card-cache';

// 開いた LINE アカウントが、どのおうちの家族かを調べる(10.3)。画面全体で1つを共有する(同じ内容を2回取りに行かない)。
// 電波が弱くても待たせないよう、前に開いたときの会員証が端末にあれば、それをすぐに出して裏で最新にする(15.3)。

type MeState = {
  me: MeResponse | null;
  /** 最新にできなかった理由(前の内容も出せないときに、画面に出す) */
  error: unknown;
  loading: boolean;
  /** いま出している内容が、端末に残した前の内容か */
  stale: boolean;
  /** 前の内容を出していて、最新にできなかった */
  refreshFailed: boolean;
};

let state: MeState | null = null;
let inflight: Promise<void> | null = null;
/** 最後に最新にできた時刻 */
let fetchedAt = 0;
/** 開いたときの画面(URL)。その画面のあいだは、開いたときに取りに行った内容をそのまま使う(同じ内容を2回取りに行かない) */
const firstPath = typeof location === 'undefined' ? '' : location.pathname;
const listeners = new Set<(s: MeState) => void>();

function set(next: Partial<MeState>) {
  state = { ...(state as MeState), ...next };
  for (const l of listeners) l(state);
}

function refresh(): Promise<void> {
  set({ loading: true, refreshFailed: false, ...(state?.me ? {} : { error: null }) });
  inflight ??= api<MeResponse>('/api/me')
    .then((me) => {
      fetchedAt = Date.now();
      if (me.registered) saveCachedCard(me);
      else clearCachedCard();
      set({ me, error: null, loading: false, stale: false, refreshFailed: false });
    })
    .catch((e: unknown) => {
      if (state?.me) set({ loading: false, refreshFailed: true });
      else set({ error: e, loading: false });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function ensure(): MeState {
  if (!state) {
    const cached = loadCachedCard();
    state = { me: cached?.me ?? null, error: null, loading: true, stale: !!cached, refreshFailed: false };
    void refresh();
  }
  return state;
}

/** 別のおうちに入った・まとめた・抜けたあと。前の内容を捨てて、読み込み直す */
export function resetMe(): Promise<void> {
  clearCachedCard();
  ensure();
  set({ me: null, stale: false, error: null });
  return refresh();
}

/**
 * revalidate: 画面を開いたときに最新にする(会員証など)。読み込み中なら、その結果を待つ(2回は取りに行かない)。
 * 最新にするあいだも、いまの内容をそのまま出す。
 */
export function useMe(opts: { revalidate?: boolean } = {}) {
  const [s, setS] = useState<MeState>(ensure);
  const revalidate = opts.revalidate ?? false;
  useEffect(() => {
    listeners.add(setS);
    setS(ensure());
    if (revalidate) {
      const justFetched = location.pathname === firstPath && Date.now() - fetchedAt < 3000;
      if (!inflight && !justFetched) void refresh();
    }
    return () => {
      listeners.delete(setS);
    };
  }, [revalidate]);
  const reload = useCallback(() => refresh(), []);
  return {
    me: s.me,
    // 前の内容を出せるときは、最新にできなくても画面を止めない(エラーの画面にしない)
    error: s.me ? null : s.error,
    loading: s.loading,
    stale: s.stale,
    refreshFailed: s.refreshFailed,
    reload,
  };
}
