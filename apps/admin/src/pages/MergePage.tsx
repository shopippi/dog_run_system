import type { HouseholdHit, MergeDogPair, MergeDogView, MergeHouseholdView, MergePreview, MergeResult } from '@dr/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { HouseholdPicker } from '../components/HouseholdPicker';
import { BusyLabel } from '../components/BusyLabel';
import { PageHead } from '../components/PageHead';
import { Loading, Skeleton, SkeletonText } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

type Brief = { id: number; memberNo: string; displayName: string; dogs: { id: number; name: string; breedName: string; thumbUrl: string | null }[] };
type Pairs = Record<number, { keep: number; take: MergeDogPair['take'] }>;

const fromHit = (h: HouseholdHit): Brief => ({ id: h.id, memberNo: h.memberNo, displayName: h.displayName, dogs: h.dogs });
const fromView = (h: MergeHouseholdView): Brief => ({ id: h.id, memberNo: h.memberNo, displayName: h.displayName, dogs: h.dogs });

function formatYmd(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/**
 * M-08 おうちの統合(A-07、要件定義書 5.3)。
 * 2つのおうちを探して選ぶ → 残す会員IDを選ぶ → 同じワンちゃんを組み合わせる → 結果を確かめる → 「まとめる」。
 * ?a=&b= を付けて開いたときは、2つのおうちが選ばれた状態で始まる。
 * (お客さん同士なら、招待を開いた人が自分でまとめられる(C-12)。ここは受付でまとめるときに使う)
 */
export function MergePage() {
  const [params] = useSearchParams();
  const { readOnly, staff } = useAuth();
  const isStaff = staff?.role === 'staff';
  const [slots, setSlots] = useState<[number | null, number | null]>(() => [
    Number(params.get('a')) || null,
    Number(params.get('b')) || null,
  ]);
  const [briefs, setBriefs] = useState<Record<number, Brief>>({});
  const [keepId, setKeepId] = useState<number | null>(null);
  const [pairs, setPairs] = useState<Pairs>({});
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{ result: MergeResult; absorbedNo: string } | null>(null);
  const toast = useToast();

  const [a, b] = slots;
  const both = a !== null && b !== null;
  const keep = keepId ?? a;
  const absorb = keep === a ? b : a;
  const dogPairs: MergeDogPair[] = useMemo(
    () => Object.entries(pairs).map(([absorbId, p]) => ({ keep: p.keep, absorb: Number(absorbId), take: p.take })),
    [pairs],
  );

  // 2つのおうちが決まったら、まとめた後の結果を確かめる(組み合わせを変えるたびに読み直す)
  useEffect(() => {
    if (!both || readOnly || isStaff || done) return;
    let alive = true;
    setError(null);
    adminPost<MergePreview>('/merges/preview', { keepHouseholdId: keep, absorbHouseholdId: absorb, dogPairs })
      .then((p) => {
        if (!alive) return;
        setBriefs((prev) => ({ ...prev, [p.kept.id]: fromView(p.kept), [p.absorbed.id]: fromView(p.absorbed) }));
        // 残す会員IDの初期値は、登録が古い方
        if (keepId === null && p.suggestedKeepHouseholdId !== p.kept.id) {
          setKeepId(p.suggestedKeepHouseholdId);
          return;
        }
        setPreview(p);
      })
      .catch((e) => {
        if (!alive) return;
        setPreview(null);
        setError(e);
      });
    return () => {
      alive = false;
    };
  }, [both, keep, absorb, dogPairs, keepId, readOnly, isStaff, done]);

  const reset = () => {
    setKeepId(null);
    setPairs({});
    setPreview(null);
    setError(null);
  };
  const pick = (slot: 0 | 1, h: HouseholdHit) => {
    setBriefs((prev) => ({ ...prev, [h.id]: fromHit(h) }));
    setSlots((prev) => (slot === 0 ? [h.id, prev[1]] : [prev[0], h.id]));
    reset();
  };
  const clear = (slot: 0 | 1) => {
    setSlots((prev) => (slot === 0 ? [null, prev[1]] : [prev[0], null]));
    reset();
  };

  if (done) {
    return (
      <MergeDone
        result={done.result}
        absorbedNo={done.absorbedNo}
        onBack={() => {
          setDone(null);
          setSlots([null, null]);
          reset();
        }}
      />
    );
  }

  const nextSlot: 0 | 1 | null = a === null ? 0 : b === null ? 1 : null;
  const ready = preview !== null && preview.kept.id === keep;
  return (
    <div className="page">
      <PageHead
        title="おうちの統合"
        howto="別々にポイントをためていた家族のおうちを、1つにまとめます。2つのおうちを選び、同じワンちゃんを写真で組み合わせ、まとめた後の内容を確かめてから「まとめる」を押してください。まとめてから30日以内なら、元に戻せます。"
      />
      {readOnly || isStaff ? (
        <div className="panel">
          <p className="empty">
            {readOnly
              ? '製作者のアカウントでは、おうちをまとめることはできません。'
              : 'おうちの統合は、管理者のアカウントで行ってください。'}
          </p>
        </div>
      ) : (
        <>
          <section className="panel mg-section" aria-labelledby="mg-step1">
            <h2 id="mg-step1" className="mg-title">
              1. まとめる2つのおうち
            </h2>
            <div className="mg-slots">
              {([0, 1] as const).map((slot) => {
                const id = slots[slot];
                const brief = id !== null ? briefs[id] : undefined;
                return (
                  <div key={slot} className="mg-slot" aria-label={`おうち${slot + 1}`} role="group">
                    {id === null ? (
                      <p className="sub-text">おうち{slot + 1}: まだ選んでいません</p>
                    ) : (
                      <>
                        <span className="stack">
                          {(brief?.dogs ?? []).map((d) => (
                            <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={48} />
                          ))}
                        </span>
                        <span className="mg-slot-body">
                          {brief ? <b>{brief.displayName}</b> : <SkeletonText size={15} w={140} />}
                          <span className="mono sub-text">{brief?.memberNo}</span>
                        </span>
                        <button type="button" className="btn ghost" onClick={() => clear(slot)}>
                          選び直す
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {nextSlot !== null && (
              <HouseholdPicker
                key={nextSlot}
                label={`おうち${nextSlot + 1}を探す`}
                excludeIds={slots.filter((s): s is number => s !== null)}
                onPick={(h) => pick(nextSlot, h)}
              />
            )}
          </section>

          {error ? <ErrorNotice error={error} /> : null}

          {both && ready && (
            <>
              <KeepChoice
                preview={preview}
                keepId={keep!}
                onChange={(id) => {
                  setKeepId(id);
                  setPairs({});
                  setPreview(null);
                }}
              />
              <DogPairing preview={preview} pairs={pairs} onChange={setPairs} />
              <ResultPanel preview={preview} />
              <div className="mg-actions">
                <button type="button" className="btn" onClick={() => setConfirming(true)}>
                  まとめる
                </button>
              </div>
            </>
          )}
          {both && !ready && !error && (
            <Loading label="まとめた後の内容を確かめています">
              <section className="panel mg-section">
                <SkeletonText size={17} lh={1.35} w={120} />
                <SkeletonText size={13} w="80%" />
                <div className="mg-keep">
                  <Skeleton h={56} r={10} />
                  <Skeleton h={56} r={10} />
                </div>
              </section>
              <section className="panel mg-section">
                <SkeletonText size={17} lh={1.35} w={220} />
                <SkeletonText size={13} lines={2} />
              </section>
            </Loading>
          )}
        </>
      )}
      {confirming && preview && (
        <MergeConfirm
          preview={preview}
          dogPairs={dogPairs}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            setDone({ result: r, absorbedNo: preview.absorbed.memberNo });
            toast(`${r.displayName}(${r.memberNo})にまとめました。`);
          }}
        />
      )}
    </div>
  );
}

/** 2. 残す会員ID(初期値は登録が古い方) */
function KeepChoice({ preview, keepId, onChange }: { preview: MergePreview; keepId: number; onChange: (id: number) => void }) {
  const options = [preview.kept, preview.absorbed].sort((x, y) => x.id - y.id);
  return (
    <section className="panel mg-section" aria-labelledby="mg-step2">
      <h2 id="mg-step2" className="mg-title">
        2. 残す会員ID
      </h2>
      <p className="sub-text">残さない方の会員IDは「統合済み」になり、探すと残す方を案内します。ふつうは登録が古い方を残します。</p>
      <div className="mg-keep" role="radiogroup" aria-label="残す会員ID">
        {options.map((h) => (
          <label key={h.id} className="pick-row">
            <input type="radio" name="mg-keep" checked={keepId === h.id} onChange={() => onChange(h.id)} />
            <span className="pick-body">
              <b className="mono">{h.memberNo}</b>
              <span className="sub-text">
                {h.displayName} · 登録 {formatYmd(h.registeredAt)} · {h.points}ポイント · 無料券{h.tickets}枚 · 来場{h.visits}回
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

/** 3. 同じワンちゃんを組み合わせる。組み合わせごとに、残す写真・名前・犬種を選ぶ */
function DogPairing({ preview, pairs, onChange }: { preview: MergePreview; pairs: Pairs; onChange: (p: Pairs) => void }) {
  const keepDogs = preview.kept.dogs;
  const usedKeep = new Map(Object.entries(pairs).map(([absorbId, p]) => [p.keep, Number(absorbId)]));
  if (preview.absorbed.dogs.length === 0 || keepDogs.length === 0) {
    return (
      <section className="panel mg-section" aria-labelledby="mg-step3">
        <h2 id="mg-step3" className="mg-title">
          3. 同じワンちゃんの組み合わせ
        </h2>
        <p className="sub-text">どちらかのおうちにワンちゃんがいないため、組み合わせはありません。</p>
      </section>
    );
  }
  return (
    <section className="panel mg-section" aria-labelledby="mg-step3">
      <h2 id="mg-step3" className="mg-title">
        3. 同じワンちゃんの組み合わせ
      </h2>
      <p className="sub-text">
        {preview.absorbed.memberNo} のワンちゃんごとに、{preview.kept.memberNo} に同じ子がいれば選んでください。同じ子は1頭にまとまり、来場の記録も1頭分になります。
      </p>
      <ul className="mg-dogs">
        {preview.absorbed.dogs.map((d) => {
          const pair = pairs[d.id];
          const partner = pair ? keepDogs.find((k) => k.id === pair.keep) : undefined;
          const set = (next: { keep: number; take: MergeDogPair['take'] } | null) => {
            const copy = { ...pairs };
            if (next) copy[d.id] = next;
            else delete copy[d.id];
            onChange(copy);
          };
          return (
            <li key={d.id} className="mg-dog" aria-label={`${d.name}の組み合わせ`}>
              <div className="mg-dog-head">
                <DogFace name={d.name} breedName={d.breedName} url={d.photoUrl ?? d.thumbUrl} size={80} />
                <span className="sel-dog-text">
                  <b>{d.name}</b>
                  <span className="sub-text">
                    {d.breedName} · <span className="mono">{d.dogNo}</span>
                  </span>
                </span>
              </div>
              <div className="field">
                <span className="label" id={`mg-same-${d.id}`}>
                  {preview.kept.memberNo} の同じワンちゃん
                </span>
                <div className="chips mg-chips" role="radiogroup" aria-labelledby={`mg-same-${d.id}`}>
                  <label>
                    <input type="radio" name={`mg-same-${d.id}`} checked={!pair} onChange={() => set(null)} />
                    <span>別のワンちゃん</span>
                  </label>
                  {keepDogs.map((k) => {
                    const takenBy = usedKeep.get(k.id);
                    const disabled = takenBy !== undefined && takenBy !== d.id;
                    return (
                      <label key={k.id} className={disabled ? 'mg-chip-off' : undefined}>
                        <input
                          type="radio"
                          name={`mg-same-${d.id}`}
                          aria-label={k.name}
                          disabled={disabled}
                          checked={pair?.keep === k.id}
                          onChange={() => set({ keep: k.id, take: 'keep' })}
                        />
                        <DogFace name={k.name} breedName={k.breedName} url={k.thumbUrl} size={28} />
                        <span>{k.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {pair && partner && (
                <div className="field">
                  <span className="label" id={`mg-take-${d.id}`}>
                    残す写真・名前・犬種
                  </span>
                  <div className="mg-take" role="radiogroup" aria-labelledby={`mg-take-${d.id}`}>
                    {(['keep', 'absorb'] as const).map((side) => {
                      const dog: MergeDogView = side === 'keep' ? partner : d;
                      return (
                        <label key={side} className="pick-row">
                          <input
                            type="radio"
                            name={`mg-take-${d.id}`}
                            aria-label={`${dog.name}(${dog.breedName})`}
                            checked={pair.take === side}
                            onChange={() => set({ keep: pair.keep, take: side })}
                          />
                          <DogFace name={dog.name} breedName={dog.breedName} url={dog.thumbUrl} size={56} />
                          <span className="pick-body">
                            <b>{dog.name}</b>
                            <span className="sub-text">
                              {dog.breedName}
                              {dog.photoUrl ? '' : '(写真なし)'}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 4. まとめた後の結果(家族・犬・ポイント・無料券) */
function ResultPanel({ preview }: { preview: MergePreview }) {
  const r = preview.result;
  return (
    <section className="panel mg-section" aria-labelledby="mg-step4">
      <h2 id="mg-step4" className="mg-title">
        4. まとめた後
      </h2>
      <div className="mg-result-head">
        <span className="stack">
          {r.dogs.map((d) => (
            <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={48} />
          ))}
        </span>
        <span className="mg-slot-body">
          <b>{r.displayName}</b>
          <span className="mono sub-text">{r.memberNo}</span>
        </span>
      </div>
      <div className="kpis mg-kpis" role="group" aria-label="まとめた後のポイント">
        <div className="kpi">
          <span className="l">ポイント</span>
          <span className="v">
            {r.points}
            <small>ポイント</small>
          </span>
        </div>
        <div className="kpi">
          <span className="l">無料券</span>
          <span className="v">
            {r.tickets}
            <small>枚{r.ticketsIssued > 0 ? `(${r.ticketsIssued}枚ふえる)` : ''}</small>
          </span>
        </div>
        <div className="kpi">
          <span className="l">来場</span>
          <span className="v">
            {r.visits}
            <small>回</small>
          </span>
        </div>
      </div>
      <dl className="mg-list">
        <dt>家族</dt>
        <dd>{r.family.map((f) => f.name || '(名前なし)').join('、') || 'なし'}</dd>
        <dt>ワンちゃん</dt>
        <dd>
          {r.dogs
            .map((d) => {
              const from = d.mergedFromId ? preview.absorbed.dogs.find((x) => x.id === d.mergedFromId) : undefined;
              return from ? `${d.name}(${from.name}と1頭にまとめる)` : d.name;
            })
            .join('、') || 'なし'}
        </dd>
        <dt>ポイントの計算</dt>
        <dd>
          {preview.kept.points} + {preview.absorbed.points}
          {preview.sameDayPointsRemoved > 0 ? ` - ${preview.sameDayPointsRemoved}(同じ日の分)` : ''} ={' '}
          {preview.kept.points + preview.absorbed.points - preview.sameDayPointsRemoved}ポイント
          {r.ticketsIssued > 0 ? `。無料券を${r.ticketsIssued}枚発行して、のこり${r.points}ポイント` : ''}
        </dd>
      </dl>
      {preview.sameDayVisitDates.length > 0 && (
        <p className="sub-text">
          {preview.sameDayVisitDates.map(formatYmd).join('、')}は両方のおうちが来場しています。どちらの来場も記録に残し、
          {preview.sameDayPointsRemoved > 0
            ? `その日の分として${preview.sameDayPointsRemoved}ポイントを差し引きます(ルールの設定による)。`
            : 'ポイントは減らしません。'}
        </p>
      )}
    </section>
  );
}

/** 確定のダイアログ。何が起きるかを見せてから「まとめる」(15.1) */
function MergeConfirm({
  preview,
  dogPairs,
  onClose,
  onDone,
}: {
  preview: MergePreview;
  dogPairs: MergeDogPair[];
  onClose: () => void;
  onDone: (r: MergeResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await adminPost<MergeResult>('/merges', {
          keepHouseholdId: preview.kept.id,
          absorbHouseholdId: preview.absorbed.id,
          dogPairs,
        }),
      );
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const r = preview.result;
  return (
    <Dialog
      title="おうちをまとめる"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy} onClick={submit}>
            <BusyLabel busy={busy} pending="まとめています…">
              まとめる
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        <b>{preview.absorbed.displayName}</b>(<span className="mono">{preview.absorbed.memberNo}</span>)を、
        <b>{preview.kept.displayName}</b>(<span className="mono">{preview.kept.memberNo}</span>)にまとめます。
      </p>
      <ul className="plain-list">
        <li>
          ポイントは{r.points}ポイント、無料券は{r.tickets}枚になります{r.ticketsIssued > 0 ? `(${r.ticketsIssued}枚ふえます)` : ''}
        </li>
        <li>家族{preview.absorbed.family.length}人と、来場の記録を移します</li>
        {dogPairs.length > 0 && <li>同じワンちゃん{dogPairs.length}組を、1頭ずつにまとめます</li>}
        <li>{preview.absorbed.memberNo} は「統合済み」になります。30日以内なら元に戻せます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

/** まとめた後。30日以内なら、ここからも元に戻せる */
function MergeDone({ result, absorbedNo, onBack }: { result: MergeResult; absorbedNo: string; onBack: () => void }) {
  const toast = useToast();
  const [undoing, setUndoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [undone, setUndone] = useState(false);
  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPost(`/merges/${result.mergeId}/undo`);
      setUndone(true);
      setUndoing(false);
      toast(`元に戻しました。${absorbedNo} と ${result.memberNo} は、まとめる前の別々のおうちに戻りました。`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageHead
        title="おうちの統合"
        crumbs={[{ label: 'おうちの統合', to: '/merge', onClick: onBack }, { label: 'まとめた結果' }]}
        howto="おうちをまとめました。お客さんの会員証にも、すぐに反映されます。"
      />
      <section className="panel mg-section" aria-label="まとめた結果">
        <p className="mg-done">
          {undone
            ? `元に戻しました。${absorbedNo} と ${result.memberNo} は、まとめる前の別々のおうちに戻りました。`
            : `${result.displayName}(${result.memberNo})にまとめました。`}
        </p>
        {!undone && (
          <>
            <dl className="mg-list">
              <dt>ポイント</dt>
              <dd>{result.points}ポイント</dd>
              <dt>無料券</dt>
              <dd>
                {result.tickets}枚{result.ticketsIssued > 0 ? `(合算で${result.ticketsIssued}枚発行しました)` : ''}
              </dd>
              <dt>元に戻せる期限</dt>
              <dd>{formatYmd(result.undoDeadline)}まで(この間に来場やポイントの変更があると、戻せません)</dd>
            </dl>
            <div className="mg-actions">
              <Link className="btn sub" to="/search">
                おうちを探す
              </Link>
              <button type="button" className="btn ghost" onClick={() => setUndoing(true)}>
                元に戻す
              </button>
            </div>
          </>
        )}
      </section>
      {undoing && (
        <Dialog
          title="統合を元に戻す"
          onClose={() => !busy && setUndoing(false)}
          footer={
            <>
              <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={() => setUndoing(false)}>
                やめる
              </button>
              <button type="button" className="btn danger-fill" disabled={busy} onClick={undo}>
                <BusyLabel busy={busy} pending="戻しています…">
                  元に戻す
                </BusyLabel>
              </button>
            </>
          }
        >
          <p>まとめる前の、2つのおうちに戻します。</p>
          <ul className="plain-list">
            <li>家族・ワンちゃん・来場の記録・無料券を、元のおうちに戻します</li>
            <li>ポイントは、まとめる前の残高に戻ります。合算で発行した無料券は回収します</li>
          </ul>
          {error ? <ErrorNotice error={error} /> : null}
        </Dialog>
      )}
    </div>
  );
}
