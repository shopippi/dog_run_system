import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import { currentUserKey } from '../../../lib/liff';
import { readJson, removeKey, writeJson } from '../../../lib/storage';

// ギャラリー(PU-2〜PU-4)の読み込み。電波が弱くても早く出すため、会員証と同じ考え方にする(要件定義書 15.3):
// - 前に開いたときの内容(アルバムの一覧・アルバムの写真の並び)を端末に残し、開いたらすぐそれを出して、裏で最新にする
// - 画面のあいだ(一覧 → 詳細 → ビューア)は、メモリの中の内容を使い回す(ビューアは通信を待たずに開く)
// - 残すのは、画面に出す内容だけ(アルバムの名前・写真の番号・価格・購入済みの印)。写真そのものは残さない
//   (写真はブラウザの保存(cache-control: private)と useAuthedImage のメモリに任せる)

const PREFIX = 'dr.photos.v1.';
/** これより古い内容は出さない(販売が終わったアルバムを、いつまでも見せない) */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** 端末に残すアルバムの数(一覧と、最近開いたアルバム) */
const MAX_SAVED = 6;

type Saved<T> = { savedAt: number; data: T };
const memory = new Map<string, Saved<unknown>>();

function storageKey(path: string): string | null {
  const user = currentUserKey();
  return user ? `${PREFIX}${user}:${path}` : null;
}

export function readSaved<T>(path: string): T | null {
  const key = storageKey(path);
  if (!key) return null;
  const mem = memory.get(key) as Saved<T> | undefined;
  if (mem) return mem.data;
  const saved = readJson<Saved<T>>(key);
  if (!saved || typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > MAX_AGE_MS) return null;
  memory.set(key, saved);
  return saved.data;
}

function writeSaved(path: string, data: unknown) {
  const key = storageKey(path);
  if (!key) return;
  const saved = { savedAt: Date.now(), data };
  memory.set(key, saved);
  writeJson(key, saved);
  // 古いものから消して、残す数を抑える(ほかの LINE ユーザーの分も消す)
  try {
    const userPrefix = key.slice(0, key.indexOf(':') + 1);
    const mine: { k: string; at: number }[] = [];
    const others: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      if (k.startsWith(userPrefix)) mine.push({ k, at: readJson<Saved<unknown>>(k)?.savedAt ?? 0 });
      else others.push(k);
    }
    mine.sort((a, b) => b.at - a.at);
    for (const k of [...others, ...mine.slice(MAX_SAVED).map((x) => x.k)]) removeKey(k);
  } catch {
    // 消せなくても動く
  }
}

function dropSaved(path: string) {
  const key = storageKey(path);
  if (!key) return;
  memory.delete(key);
  removeKey(key);
}

/** 見つからない・準備中など、前の内容を出し続けてはいけない失敗か(電波やサーバーの一時的な不調は除く) */
const isFinal = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

export type GalleryLoad<T> = {
  data: T | null;
  error: unknown;
  /** 前に開いたときの内容を出していて、最新にしている途中 */
  refreshing: boolean;
  /** 最新にできなかった(電波が弱い)。前に開いたときの内容を出している */
  failed: boolean;
  reload: () => void;
};

/** 前に開いたときの内容をすぐ出し、裏で最新にする(stale-while-revalidate) */
export function useGalleryData<T>(path: string): GalleryLoad<T> {
  const [data, setData] = useState<T | null>(() => readSaved<T>(path));
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setError(null);
    setFailed(false);
    setRefreshing(true);
    api<T>(path)
      .then((d) => {
        if (n !== seq.current) return;
        writeSaved(path, d);
        setData(d);
      })
      .catch((e: unknown) => {
        if (n !== seq.current) return;
        if (isFinal(e)) {
          dropSaved(path);
          setData(null);
          setError(e);
        } else if (readSaved<T>(path)) {
          setFailed(true);
        } else {
          setError(e);
        }
      })
      .finally(() => {
        if (n === seq.current) setRefreshing(false);
      });
  }, [path]);

  useEffect(() => {
    setData(readSaved<T>(path));
    load();
  }, [path, load]);

  return { data, error, refreshing, failed, reload: load };
}

// ---------------------------------------------------------------- 画面のあいだで覚えておくもの(この端末のこのタブだけ)

export function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(`${PREFIX}${key}`);
    else sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // 覚えられなくても動く
  }
}
