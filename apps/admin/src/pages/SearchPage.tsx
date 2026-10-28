import type { HouseholdHit, HouseholdSearchResponse } from '@dr/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
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
export function SearchPage({
  actions,
  title = 'おうちを探す',
  howto,
}: {
  actions?: (h: HouseholdHit) => ReactNode;
  title?: string;
  howto?: string;
}) {
  const [mode, setMode] = useState<Mode>('name');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<HouseholdHit[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<HouseholdHit | null>(null);
  // おうちの詳細(A-02)は管理者と製作者だけが開ける
  const { staff } = useAuth();
  const canOpenDetail = staff?.role === 'admin' || staff?.role === 'developer';

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


  return (
    <div className="page">
      <PageHead
        title={title}
        howto={
          howto ??
          '犬の名前・おうちの呼び名・会員ID・LINEの名前の一部を入れると、当てはまるおうちが出ます。ひらがなとカタカナはどちらでも探せます。名前が分からないときは「写真で探す」から選んでください。'
        }
      />
      <div className="search-bar">
        <div className="segment" role="tablist" aria-label="探し方">
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
          <div className="search-field">
            <Icon name="search" size={20} />
            <input
              type="search"
              aria-label="探す言葉"
              placeholder="例: アル、DR-000123"
              value={q}
              autoFocus
              onChange={(e) => {
                setQ(e.target.value);
                setSelected(null);
              }}
            />
          </div>
        )}
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      {selected && <HouseholdCard key={selected.id} h={selected} onClose={() => setSelected(null)} actions={actions} />}
      {hits === null ? null : hits.length === 0 ? (
        <div className="panel">
          <p className="empty">
            {mode === 'photo' ? 'まだ来場したおうちがありません。' : '見つかりませんでした。別の言葉や、会員IDで探してみてください。'}
          </p>
        </div>
      ) : mode === 'photo' ? (
        <section className="panel">
          <ul className="photo-grid" aria-label="最近来たワンちゃん">
            {hits.flatMap((h) =>
              h.dogs.map((d) => (
                <li key={`${h.id}-${d.id}`}>
                  <button
                    type="button"
                    className="photo-cell"
                    aria-current={selected?.id === h.id}
                    onClick={() => setSelected(h)}
                  >
                    <DogFace name={d.name} breedName={d.breedName} url={d.thumbUrl} size={120} shape="square" />
                    <b>{d.name}</b>
                    <span className="sub-text">{h.displayName}</span>
                  </button>
                </li>
              )),
            )}
          </ul>
        </section>
      ) : (
        <section className="panel list-panel">
          <ul className="results" aria-label="見つかったおうち">
            {hits.map((h) => (
              <li key={h.id} className={canOpenDetail ? 'result-item' : undefined}>
                <button
                  type="button"
                  className="result-row"
                  aria-current={selected?.id === h.id}
                  onClick={() => setSelected(h)}
                >
                  <span className="stack">
                    {h.dogs.map((d) => (
                      <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
                    ))}
                  </span>
                  <span className="result-body">
                    <b>{h.displayName}</b>
                    <span className="mono sub-text">{h.memberNo}</span>
                  </span>
                  {h.status === 'merged' ? (
                    <span className="badge">統合済み → {h.mergedIntoMemberNo}</span>
                  ) : h.status === 'withdrawn' ? (
                    <span className="badge">退会</span>
                  ) : (
                    <span className="sub-text result-last">{formatDate(h.lastVisit)}</span>
                  )}
                  <Icon name="chevron-right" />
                </button>
                {canOpenDetail && (
                  <Link className="btn ghost result-open" to={`/households/${h.id}`} aria-label={`${h.displayName}の詳細を開く`}>
                    詳しく
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
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
        <div className="sel-title">
          <h2>{h.displayName}</h2>
          <p className="sub-text">
            <span className="mono">{h.memberNo}</span>
            <span aria-hidden="true"> · </span>
            {formatDate(h.lastVisit)}
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
      {h.status === 'merged' && (
        <div className="alert info">
          このおうちは、<b className="mono">{h.mergedIntoMemberNo}</b> にまとめられています。そちらの会員IDで探してください。
        </div>
      )}
      <div className="sel-dogs">
        {h.dogs.map((d) => (
          <div key={d.id} className="sel-dog">
            <DogFace name={d.name} breedName={d.breedName} url={d.thumbUrl} size={80} />
            <span className="sel-dog-text">
              <b>{d.name}</b>
              <span className="sub-text">{d.breedName}</span>
            </span>
          </div>
        ))}
      </div>
      {h.familyNames.length > 0 && (
        <dl className="sel-meta">
          <dt>家族</dt>
          <dd>{h.familyNames.join('、')}</dd>
        </dl>
      )}
      {h.status === 'active' && actions?.(h)}
    </section>
  );
}
