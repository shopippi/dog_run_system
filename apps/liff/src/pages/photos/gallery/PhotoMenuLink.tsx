import type { PhotoConfigResponse } from '@dr/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import { api } from '../../../lib/api';
import { readJson, writeJson } from '../../../lib/storage';

// 会員証のメニューの「写真を買う」(段階1-B)。写真の販売が始まっているときだけ出す(docs/photo-requirements.md 9.1)。
// 会員証はいちばんよく開く画面なので、会員証の読み込みを邪魔しない:
// - 前に確かめた結果(端末に残す)をすぐ使い、少し待ってから裏で確かめ直す(1回だけ。届かなくても何もしない)
// - 会員証の画面と一緒に読み込まれるので、写真の画面のファイルは読み込まない(この部品だけ)

const KEY = 'dr.photos.v1.available';
/** 会員証の読み込みが先に済むよう、少し待ってから確かめる */
const DELAY_MS = 1200;

export function PhotoMenuLink() {
  const [available, setAvailable] = useState(() => readJson<boolean>(KEY) === true);
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      api<PhotoConfigResponse>('/api/photos/config', { attempts: 1 })
        .then((c) => {
          writeJson(KEY, c.available);
          if (alive) setAvailable(c.available);
        })
        .catch(() => undefined);
    }, DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);
  if (!available) return null;
  return (
    <Link to="/photos">
      <span>写真を買う</span>
      <Icon name="chevron-right" />
    </Link>
  );
}
