import type { HouseholdHit, HouseholdSearchResponse } from '@dr/shared';
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/api';
import { DogFace } from './DogFace';
import { ErrorNotice } from './ErrorNotice';
import { Icon } from './Icon';

/**
 * おうちを探して選ぶ部品(おうちの統合・旧カードの移行で使う)。
 * おうちを探す画面(M-04)と同じく、犬の名前・呼び名・会員ID・LINEの名前で探すか、最近来たおうちの写真から選ぶ。
 * 統合済み・退会のおうちは選べない(理由を表示する)。
 */
export function HouseholdPicker({
  label,
  onPick,
  excludeIds = [],
}: {
  /** 部品の名前(読み上げと、候補の一覧の名前に使う) */
  label: string;
  onPick: (h: HouseholdHit) => void;
  excludeIds?: number[];
}) {
  const [mode, setMode] = useState<'name' | 'photo'>('name');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<HouseholdHit[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const query = mode === 'photo' ? '' : q.trim();
    if (mode === 'name' && !query) {
      setHits(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      adminApi<HouseholdSearchResponse>(`/households?q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (!alive) return;
          setHits(r.households.filter((h) => !excludeIds.includes(h.id)));
          setError(null);
        })
        .catch((e) => alive && setError(e));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // excludeIds は選び直しのたびに変わるので、文字列にして比べる
  }, [q, mode, excludeIds.join(',')]);

  const active = (hits ?? []).filter((h) => h.status === 'active');
  return (
    <div className="picker" role="group" aria-label={label}>
      <div className="search-bar">
        <div className="segment" role="tablist" aria-label="探し方">
          <button type="button" role="tab" aria-selected={mode === 'name'} onClick={() => setMode('name')}>
            名前で探す
          </button>
          <button type="button" role="tab" aria-selected={mode === 'photo'} onClick={() => setMode('photo')}>
            写真で探す
          </button>
        </div>
        {mode === 'name' && (
          <div className="search-field">
            <Icon name="search" size={20} />
            <input
              type="search"
              aria-label="探す言葉"
              placeholder="例: アル、DR-000123"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      {hits === null ? null : hits.length === 0 ? (
        <p className="empty">
          {mode === 'photo' ? 'まだ来場したおうちがありません。名前で探してください。' : '見つかりませんでした。別の言葉や、会員IDで探してみてください。'}
        </p>
      ) : mode === 'photo' ? (
        <ul className="photo-grid picker-grid" aria-label={`${label}の候補`}>
          {active.flatMap((h) =>
            h.dogs.map((d) => (
              <li key={`${h.id}-${d.id}`}>
                <button type="button" className="photo-cell" onClick={() => onPick(h)}>
                  <DogFace name={d.name} breedName={d.breedName} url={d.thumbUrl} size={120} shape="square" />
                  <b>{d.name}</b>
                  <span className="sub-text">{h.displayName}</span>
                </button>
              </li>
            )),
          )}
        </ul>
      ) : (
        <ul className="results picker-results" aria-label={`${label}の候補`}>
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="result-row" disabled={h.status !== 'active'} onClick={() => onPick(h)}>
                <span className="stack">
                  {h.dogs.map((d) => (
                    <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
                  ))}
                </span>
                <span className="result-body">
                  <b>{h.displayName}</b>
                  <span className="sub-text">
                    <span className="mono">{h.memberNo}</span>
                    {h.familyNames.length > 0 && (
                      <>
                        <span aria-hidden="true"> · </span>
                        {h.familyNames.join('、')}
                      </>
                    )}
                  </span>
                </span>
                {h.status === 'merged' ? (
                  <span className="badge">統合済み → {h.mergedIntoMemberNo}</span>
                ) : h.status === 'withdrawn' ? (
                  <span className="badge">退会</span>
                ) : (
                  <span className="sub-text result-last">選ぶ</span>
                )}
                <Icon name="chevron-right" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
