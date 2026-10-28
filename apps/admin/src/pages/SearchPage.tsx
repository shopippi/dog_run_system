import type { HouseholdHit, HouseholdSearchResponse } from '@dr/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';

type Mode = 'name' | 'photo';

function formatDate(ymd: string | null) {
  if (!ymd) return 'まだ来場なし';
  const [, m, d] = ymd.split('-').map(Number);
  return `最後の来場 ${m}/${d}`;
}

/**
 * M-04 おうちを探す(S-06)。犬の名前・おうちの呼び名・会員IDで探す。
 * 「写真で探す」では、最近来たおうちの犬の写真を並べる(6.3)。
 */
export function SearchPage({ actions, howto }: { actions?: (h: HouseholdHit) => ReactNode; howto?: string }) {
  const { staff } = useAuth();
  const [mode, setMode] = useState<Mode>('name');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<HouseholdHit[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<HouseholdHit | null>(null);

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
          setHits(r.households);
          setError(null);
        })
        .catch((e) => alive && setError(e));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, mode]);

  const nameHint = staff?.role === 'staff' ? '犬の名前・おうちの呼び名・会員ID' : '犬の名前・おうちの呼び名・会員ID・LINEの名前';

  return (
    <main className="con-body">
      <p className="howto">
        {howto ??
          `${nameHint}の一部を入れると、当てはまるおうちが出ます。ひらがなとカタカナはどちらでも探せます。名前が分からないときは「写真で探す」から選んでください。`}
      </p>
      <div className="seg" role="tablist" aria-label="探し方">
        <button type="button" role="tab" aria-selected={mode === 'name'} onClick={() => setMode('name')}>
          名前で探す
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'photo'}
          onClick={() => {
            setMode('photo');
            setSelected(null);
          }}
        >
          写真で探す
        </button>
      </div>
      {mode === 'name' && (
        <div className="search">
          <input
            type="search"
            aria-label="探す言葉"
            placeholder={`例: アル、DR-000123`}
            value={q}
            autoFocus
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(null);
            }}
          />
        </div>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      {selected && <HouseholdCard key={selected.id} h={selected} onClose={() => setSelected(null)} actions={actions} />}
      {hits === null ? null : hits.length === 0 ? (
        <p className="empty">
          {mode === 'photo' ? 'まだ来場したおうちがありません。' : '見つかりませんでした。別の言葉や、会員IDで探してみてください。'}
        </p>
      ) : mode === 'photo' ? (
        <ul className="photo-grid" aria-label="最近来たワンちゃん">
          {hits.flatMap((h) =>
            h.dogs.map((d) => (
              <li key={`${h.id}-${d.id}`}>
                <button type="button" className="photo-cell" onClick={() => setSelected(h)}>
                  <DogFace name={d.name} breedName={d.breedName} url={d.thumbUrl} size={120} />
                  <b>{d.name}</b>
                  <span className="small muted">{h.displayName}</span>
                </button>
              </li>
            )),
          )}
        </ul>
      ) : (
        <ul className="hgrid" aria-label="見つかったおうち">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="hcard"
                aria-current={selected?.id === h.id}
                onClick={() => setSelected(h)}
              >
                <span className="faces">
                  {h.dogs.map((d) => (
                    <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={64} />
                  ))}
                </span>
                <b>{h.displayName}</b>
                <span className="mono small">{h.memberNo}</span>
                {h.status === 'merged' ? (
                  <span className="pill o">統合済み → {h.mergedIntoMemberNo}</span>
                ) : h.status === 'withdrawn' ? (
                  <span className="pill">退会</span>
                ) : (
                  <span className="small muted">{formatDate(h.lastVisit)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function HouseholdCard({
  h,
  onClose,
  actions,
}: {
  h: HouseholdHit;
  onClose: () => void;
  actions?: (h: HouseholdHit) => ReactNode;
}) {
  return (
    <section className="panel selected" aria-label={`${h.displayName}の内容`}>
      <div className="sel-head">
        <div>
          <h2>{h.displayName}</h2>
          <p className="mono">{h.memberNo}</p>
        </div>
        <button type="button" className="btn sub small" onClick={onClose}>
          閉じる
        </button>
      </div>
      {h.status === 'merged' && (
        <div className="notice">
          このおうちは、<b className="mono">{h.mergedIntoMemberNo}</b> にまとめられています。そちらの会員IDで探してください。
        </div>
      )}
      <div className="sel-dogs">
        {h.dogs.map((d) => (
          <div key={d.id} className="sel-dog">
            <DogFace name={d.name} breedName={d.breedName} url={d.thumbUrl} size={96} />
            <b>{d.name}</b>
            <span className="small muted">{d.breedName}</span>
          </div>
        ))}
      </div>
      <p className="small muted">
        {formatDate(h.lastVisit)}
        {h.familyNames && h.familyNames.length > 0 ? `・家族: ${h.familyNames.join('、')}` : ''}
      </p>
      {h.status === 'active' && actions?.(h)}
    </section>
  );
}
