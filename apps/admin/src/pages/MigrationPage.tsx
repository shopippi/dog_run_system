import {
  MIGRATION_SOURCES,
  MIGRATION_SOURCE_LABELS,
  planMigration,
  type HouseholdHit,
  type MigrationListResponse,
  type MigrationRecord,
  type MigrationResult,
  type WithAuditId,
  type MigrationSource,
  type MigrationStatus,
} from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { HouseholdPicker } from '../components/HouseholdPicker';
import { BusyLabel } from '../components/BusyLabel';
import { PageHead } from '../components/PageHead';
import { Loading, Skeleton, SkeletonGhost, SkeletonText } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { adminApi, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/jst-format';

/**
 * M-09 旧カードの引き継ぎ(A-05、要件定義書 16章)。受付で旧カードを見せてもらったときだけ、管理者が直接入力する。
 * - 「直接入力」: おうちを探して選び、カードの種類とポイント数を入れる。旧カードを目で確かめたこと・紙のカードを回収したことの印が必須
 * - 「引き継ぎ済みの一覧」: いつ・誰が・どのおうちに・何ポイント。間違えたものは元に戻せる(操作ログの「元に戻す」と同じ)
 */
export function MigrationPage() {
  const [listKey, setListKey] = useState(0);
  return (
    <div className="page">
      <PageHead
        title="旧カードの引き継ぎ"
        howto="お客さんが受付で旧カード(LINEのショップカード・紙のスタンプカード)を見せてくれたときに使います。カードを目で確かめてからポイント数を入れ、紙のカードは回収するか使用済みの印を付けてください。"
      />
      <DirectMigration onDone={() => setListKey((k) => k + 1)} />
      <MigratedList key={listKey} />
    </div>
  );
}

/** ポイント数の入力欄の値を、0 以上の整数として読む。読めなければ null */
function parsePoints(v: string): number | null {
  const t = v.normalize('NFKC').trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  return Number(t);
}

/** 移行元(LINEのショップカード / 紙のスタンプカード)を選ぶ */
function SourceChoice({
  value,
  onChange,
  done,
}: {
  value: MigrationSource | null;
  onChange: (s: MigrationSource) => void;
  /** 引き継ぎ済みの移行元(選べない) */
  done: Partial<Record<MigrationSource, boolean>>;
}) {
  return (
    <div className="field">
      <span className="label" id="mi-src-label">
        旧カードの種類
      </span>
      <div className="chips" role="radiogroup" aria-labelledby="mi-src-label">
        {MIGRATION_SOURCES.map((s) => (
          <label key={s} className={done[s] ? 'rq-chip-off' : undefined}>
            <input type="radio" name="mi-src" checked={value === s} disabled={done[s]} onChange={() => onChange(s)} />
            <span>
              {MIGRATION_SOURCE_LABELS[s]}
              {done[s] ? '(引き継ぎ済み)' : ''}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** 直接入力(16.1)。おうちを選び、カードの種類・ポイント数・2つの確認の印を入れて「引き継ぐ」 */
function DirectMigration({ onDone }: { onDone: () => void }) {
  const { readOnly } = useAuth();
  const [picked, setPicked] = useState<HouseholdHit | null>(null);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [source, setSource] = useState<MigrationSource | null>(null);
  const [pointsText, setPointsText] = useState('');
  const [confirmedCard, setConfirmedCard] = useState(false);
  const [collectedCard, setCollectedCard] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  const load = useCallback(async (id: number) => {
    setError(null);
    try {
      const s = await adminApi<MigrationStatus>(`/households/${id}/migration`);
      setStatus(s);
      setSource((prev) => (prev && !s.migrated[prev] ? prev : (MIGRATION_SOURCES.find((x) => !s.migrated[x]) ?? null)));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    if (picked) void load(picked.id);
  }, [picked, load]);

  const reset = () => {
    setPointsText('');
    setConfirmedCard(false);
    setCollectedCard(false);
  };

  if (readOnly) {
    return (
      <section className="panel mg-section" aria-label="直接入力">
        <h2 className="mg-title">直接入力</h2>
        <p className="empty">製作者のアカウントでは、旧カードの引き継ぎは入力できません。</p>
      </section>
    );
  }
  const points = parsePoints(pointsText);
  const max = status?.maxPoints ?? 0;
  const over = points !== null && status !== null && points > max;
  const doneMap = status ? Object.fromEntries(MIGRATION_SOURCES.map((s) => [s, Boolean(status.migrated[s])])) : {};
  const allDone = status ? MIGRATION_SOURCES.every((s) => status.migrated[s]) : false;
  const ready = points !== null && !over && !!source && !!status?.inPeriod && confirmedCard && collectedCard;
  return (
    <section className="panel mg-section" aria-label="直接入力">
      <h2 className="mg-title">直接入力</h2>
      {!picked ? (
        <HouseholdPicker
          label="引き継ぐおうちを探す"
          onPick={(h) => {
            setPicked(h);
            reset();
          }}
        />
      ) : (
        <>
          <div className="mg-slot" role="group" aria-label="引き継ぐおうち">
            <span className="stack">
              {picked.dogs.map((d) => (
                <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={48} />
              ))}
            </span>
            <span className="mg-slot-body">
              <b>{picked.displayName}</b>
              <span className="sub-text">
                <span className="mono">{picked.memberNo}</span>
                {status ? ` · いま ${status.points}ポイント` : ''}
              </span>
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setPicked(null);
                setStatus(null);
                setError(null);
                reset();
              }}
            >
              選び直す
            </button>
          </div>
          {status && !status.inPeriod && (
            <div className="alert warning">
              <p>
                いまは旧カードの引き継ぎを受け付ける期間の外です({status.period.start ?? ''}〜{status.period.end ?? ''})。期間を変えるときは、ルールの設定で移行期間を直してください。
              </p>
            </div>
          )}
          {!status && !error && (
            <Loading>
              <div className="field">
                <SkeletonText size={13} w={96} />
                <div className="chips">
                  <Skeleton w={176} h="var(--control-h)" r={8} />
                  <Skeleton w={160} h="var(--control-h)" r={8} />
                </div>
              </div>
              <div className="field rq-points">
                <SkeletonText size={13} w={136} />
                <Skeleton w={160} h={44} r={8} />
              </div>
            </Loading>
          )}
          {status && allDone ? (
            <p className="sub-text">このおうちは、両方の旧カードの引き継ぎが済んでいます。同じカードは1回だけ引き継げます。</p>
          ) : status ? (
            <>
              <SourceChoice value={source} onChange={setSource} done={doneMap} />
              <div className="field rq-points">
                <label htmlFor="mi-points">旧カードのポイント数</label>
                <input
                  id="mi-points"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="例: 7"
                  aria-describedby="mi-points-hint"
                  value={pointsText}
                  onChange={(e) => setPointsText(e.target.value)}
                />
                <span className={over ? 'err' : 'hint'} id="mi-points-hint">
                  {over ? `引き継げるポイントは最大${max}ポイントです。` : `0〜${max}ポイントまで引き継げます`}
                </span>
              </div>
              {points !== null && !over && (
                <p className="rq-preview" role="status">
                  いま {status.points}ポイント → 引き継ぎ後 <b>{planMigration(status.points, points).balanceAfter}ポイント</b>
                </p>
              )}
              <fieldset className="mi-checks">
                <legend className="label">受付での確認(両方に印を付けてください)</legend>
                <label className="check">
                  <input type="checkbox" checked={confirmedCard} onChange={(e) => setConfirmedCard(e.target.checked)} />
                  旧カードを目で確かめた
                </label>
                <label className="check">
                  <input type="checkbox" checked={collectedCard} onChange={(e) => setCollectedCard(e.target.checked)} />
                  紙のカードは回収した(または使用済みの印を付けた)
                </label>
              </fieldset>
              <div className="mg-actions">
                <button type="button" className="btn" disabled={!ready} onClick={() => setConfirming(true)}>
                  引き継ぐ
                </button>
              </div>
            </>
          ) : null}
          {error ? <ErrorNotice error={error} /> : null}
        </>
      )}
      {confirming && picked && status && source && points !== null && (
        <DirectConfirm
          household={picked}
          source={source}
          points={points}
          balance={status.points}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            reset();
            void load(picked.id);
            onDone();
            toast({
              message: `${MIGRATION_SOURCE_LABELS[r.source]}の${r.points}ポイントを引き継ぎました。いまのポイントは${r.balance}ポイントです。`,
              undo: {
                auditId: r.auditId ?? null,
                doneMessage: `${MIGRATION_SOURCE_LABELS[r.source]}の引き継ぎを元に戻しました。`,
                onUndone: () => {
                  void load(picked.id);
                  onDone();
                },
              },
            });
          }}
        />
      )}
    </section>
  );
}

function DirectConfirm({
  household,
  source,
  points,
  balance,
  onClose,
  onDone,
}: {
  household: HouseholdHit;
  source: MigrationSource;
  points: number;
  balance: number;
  onClose: () => void;
  onDone: (r: MigrationResult & Partial<WithAuditId>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const plan = planMigration(balance, points);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await adminPost<MigrationResult & WithAuditId>(`/households/${household.id}/migrate`, {
          source,
          points,
          confirmed_card: true,
          collected_card: true,
        }),
      );
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="旧カードのポイントを引き継ぐ"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy} onClick={submit}>
            <BusyLabel busy={busy} pending="引き継いでいます…">
              引き継ぐ
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        <b>{household.displayName}</b>(<span className="mono">{household.memberNo}</span>)に、{MIGRATION_SOURCE_LABELS[source]}の
        <b>{points}ポイント</b>を引き継ぎます。
      </p>
      <ul className="plain-list">
        <li>
          ポイントは {balance} → {plan.balanceAfter}ポイントになります
        </li>
        <li>{MIGRATION_SOURCE_LABELS[source]}の引き継ぎは、このおうちではこの1回だけです</li>
        <li>間違えたときは、お知らせの「元に戻す」か、下の「引き継ぎ済みの一覧」から元に戻せます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

/** 引き継ぎ済みの一覧(いつ・誰が・どのおうち・何ポイント・元に戻す) */
function MigratedList() {
  const { readOnly } = useAuth();
  const [data, setData] = useState<MigrationListResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [undoing, setUndoing] = useState<MigrationRecord | null>(null);
  const toast = useToast();
  const reload = useCallback(async () => {
    try {
      setData(await adminApi<MigrationListResponse>('/migrations'));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="panel mg-section" aria-label="引き継ぎ済みの一覧">
      <h2 className="mg-title">引き継ぎ済みの一覧</h2>
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        error ? null : (
          <Loading>
            <ul className="mi-list">
              {Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="mi-row">
                  <span className="mi-when">
                    <SkeletonText size={14} w={120} />
                    <SkeletonText size={13} w={56} />
                  </span>
                  <span className="mi-main">
                    <SkeletonText size={14} w={[150, 120, 170][i]} />
                    <SkeletonText size={13} w={200} />
                  </span>
                  <span className="mi-points">
                    <Skeleton w={56} h={20} r={4} />
                  </span>
                  <span className="mi-end">
                    <SkeletonGhost w={56} />
                  </span>
                </li>
              ))}
            </ul>
          </Loading>
        )
      ) : data.records.length === 0 ? (
        <p className="empty">まだ引き継いだ旧カードはありません。</p>
      ) : (
        <ul className="mi-list" aria-label="引き継ぎ済みの旧カード">
          {data.records.map((r) => (
            <li
              key={r.auditId}
              className={`mi-row${r.undone ? ' off' : ''}`}
              aria-label={`${r.householdName} ${r.memberNo} ${MIGRATION_SOURCE_LABELS[r.source]}`}
            >
              <span className="mi-when">
                <span className="mono">{formatDateTime(r.at)}</span>
                <span className="sub-text">{r.staffName ?? '(停止したスタッフ)'}</span>
              </span>
              <span className="mi-main">
                <b>{r.householdName}</b>
                <span className="sub-text">
                  <span className="mono">{r.memberNo}</span> · {MIGRATION_SOURCE_LABELS[r.source]}
                </span>
              </span>
              <span className="mi-points">
                <b>{r.points}</b>
                <small>ポイント</small>
              </span>
              <span className="mi-end">
                {r.undone ? (
                  <span className="badge">元に戻しました {formatDateTime(r.undone.at)}</span>
                ) : readOnly ? null : (
                  <button type="button" className="btn ghost" onClick={() => setUndoing(r)}>
                    元に戻す
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {undoing && (
        <UndoDialog
          r={undoing}
          onClose={() => setUndoing(null)}
          onDone={() => {
            toast(`${undoing.householdName}の${MIGRATION_SOURCE_LABELS[undoing.source]}の引き継ぎを元に戻しました。`);
            setUndoing(null);
            void reload();
          }}
        />
      )}
    </section>
  );
}

function UndoDialog({ r, onClose, onDone }: { r: MigrationRecord; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPost(`/audit/${r.auditId}/undo`);
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="引き継ぎを元に戻す"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy} onClick={submit}>
            <BusyLabel busy={busy} pending="元に戻しています…">
              元に戻す
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        <b>{r.householdName}</b>(<span className="mono">{r.memberNo}</span>)の、{MIGRATION_SOURCE_LABELS[r.source]}から引き継いだ
        <b>{r.points}ポイント</b>を取り消します。
      </p>
      <ul className="plain-list">
        <li>引き継いだポイントを差し引きます</li>
        <li>元に戻したあとは、同じカードをもう一度入力できます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
