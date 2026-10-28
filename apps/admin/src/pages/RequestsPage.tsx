import {
  MIGRATION_SOURCES,
  MIGRATION_SOURCE_LABELS,
  REJECT_REASONS,
  planMigration,
  type HouseholdHit,
  type MigrationResult,
  type MigrationSource,
  type MigrationStatus,
  type RequestHousehold,
  type RequestItem,
  type RequestListResponse,
} from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { HouseholdPicker } from '../components/HouseholdPicker';
import { PageHead } from '../components/PageHead';
import { adminApi, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

type Tab = 'pending' | 'handled' | 'direct';

const KIND_LABELS: Record<RequestItem['kind'], string> = {
  merge: 'おうちをまとめる申請',
  migration: '旧カードの引き継ぎ',
};

export function formatDateTime(iso: string) {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}月${d}日 ${iso.slice(11, 16)}`;
}

/**
 * M-09 確認待ち(A-05・A-08)。お客さんからの申請を確かめて処理する。
 * - おうちをまとめる申請: 「統合の画面に進む」で M-08 を開く(統合すると承認になる)。却下もできる
 * - 旧カードの引き継ぎ申請: 写真を見てポイント数を確認・修正して承認する(A-05)。却下もできる
 * - 処理済みのタブで、承認・却下した申請を見られる
 * - 「受付で直接入力」のタブで、受付で旧カードを見せてもらったおうちに、ポイントを引き継ぐ(A-05、16.1)
 */
export function RequestsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  return (
    <div className="page">
      <PageHead
        title="確認待ち"
        howto="お客さんからの申請です。旧カードの引き継ぎは写真でポイント数を確かめて承認し、おうちをまとめる申請は「統合の画面に進む」から写真で確かめてまとめます。違うときは「却下する」を押して理由を選びます。"
        aside={
          // 申請がなくても、別々にためていたおうちをまとめられるように
          <Link className="btn ghost" to="/merge">
            おうちの統合を開く
          </Link>
        }
      />
      <div className="segment rq-tabs" role="tablist" aria-label="表示する申請">
        <button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
          確認待ち
        </button>
        <button type="button" role="tab" aria-selected={tab === 'handled'} onClick={() => setTab('handled')}>
          処理済み
        </button>
        <button type="button" role="tab" aria-selected={tab === 'direct'} onClick={() => setTab('direct')}>
          受付で直接入力
        </button>
      </div>
      {tab === 'direct' ? <DirectMigration /> : <RequestList key={tab} tab={tab} />}
    </div>
  );
}

function RequestList({ tab }: { tab: Tab }) {
  const { readOnly } = useAuth();
  const [data, setData] = useState<RequestListResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async () => {
    try {
      setData(await adminApi<RequestListResponse>(`/requests${tab === 'handled' ? '?status=handled' : ''}`));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [tab]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <p className="loading">読み込んでいます…</p>;
  if (data.requests.length === 0) {
    return (
      <div className="panel">
        <p className="empty">{tab === 'pending' ? '確認待ちの申請はありません。' : '処理済みの申請はまだありません。'}</p>
      </div>
    );
  }
  return (
    <section className="panel list-panel">
      <ul className="rq-list" aria-label={tab === 'pending' ? '確認待ちの申請' : '処理済みの申請'}>
        {data.requests.map((r) => (
          <RequestRow
            key={r.id}
            r={r}
            canEdit={!readOnly && tab === 'pending'}
            pointsPerTicket={data.pointsPerTicket}
            onChanged={reload}
          />
        ))}
      </ul>
    </section>
  );
}

function HouseholdBlock({ h, label }: { h: RequestHousehold; label: string }) {
  return (
    <div className="rq-house">
      <span className="rq-house-label">{label}</span>
      <div className="rq-house-main">
        <span className="stack">
          {h.dogs.map((d) => (
            <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
          ))}
        </span>
        <span className="result-body">
          <b>{h.displayName}</b>
          <span className="sub-text">
            <span className="mono">{h.memberNo}</span>
            {h.status === 'merged' && <> · 統合済み → {h.mergedIntoMemberNo}</>}
            {h.status === 'withdrawn' && <> · 退会</>}
          </span>
        </span>
      </div>
    </div>
  );
}

function RequestRow({
  r,
  canEdit,
  pointsPerTicket,
  onChanged,
}: {
  r: RequestItem;
  canEdit: boolean;
  pointsPerTicket: number;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const label = `${KIND_LABELS[r.kind]} ${r.household.displayName} ${r.household.memberNo}`;
  return (
    <li className="rq-row" aria-label={label}>
      <div className="rq-meta">
        <span className={`badge${r.kind === 'merge' ? ' info' : ' warning'}`}>{KIND_LABELS[r.kind]}</span>
        <span className="sub-text">
          {formatDateTime(r.createdAt)}
          {r.requester ? ` · ${r.requester}さんから` : ''}
        </span>
        {r.status !== 'pending' && (
          <span className="badge">
            {r.status === 'approved' ? '承認' : '却下'}
            {r.handledAt ? ` ${formatDateTime(r.handledAt)}` : ''}
          </span>
        )}
      </div>
      <div className="rq-body">
        <HouseholdBlock h={r.household} label={r.kind === 'merge' ? '申請したおうち' : 'おうち'} />
        {r.related && <HouseholdBlock h={r.related} label="まとめる相手" />}
        {r.kind === 'migration' && (
          <div className="rq-house">
            <span className="rq-house-label">旧カード</span>
            <div className="rq-house-main">
              {r.attachmentUrl ? (
                <a className="rq-photo" href={r.attachmentUrl} target="_blank" rel="noreferrer" aria-label="旧カードの写真を大きく見る">
                  <img src={r.attachmentUrl} alt="旧カードの写真" width={72} height={72} />
                </a>
              ) : (
                <span className="sub-text">写真なし</span>
              )}
              <span className="result-body">
                <b>
                  {r.migration
                    ? `${MIGRATION_SOURCE_LABELS[r.migration.source]} ${r.migration.claimedPoints !== null ? `${r.migration.claimedPoints}ポイント` : '(ポイント数の記入なし)'}`
                    : '申請の内容を読めません'}
                </b>
                {r.migration?.note && <span className="sub-text">{r.migration.note}</span>}
              </span>
            </div>
          </div>
        )}
      </div>
      {r.status !== 'pending' && (r.handledBy || r.handleNote) && (
        <p className="sub-text">
          {r.handledBy ? `処理した人: ${r.handledBy}` : ''}
          {r.handleNote ? `${r.handledBy ? ' · ' : ''}${r.status === 'rejected' ? '理由' : 'メモ'}: ${r.handleNote}` : ''}
        </p>
      )}
      {canEdit && (
        <div className="rq-actions">
          {r.kind === 'merge' && r.related && (
            <Link className="btn sub" to={`/merge?a=${r.related.id}&b=${r.household.id}&request=${r.id}`}>
              統合の画面に進む
            </Link>
          )}
          {r.kind === 'migration' && (
            <button type="button" className="btn sub" onClick={() => setApproving(true)}>
              確かめて承認する
            </button>
          )}
          <button type="button" className="btn ghost" onClick={() => setRejecting(true)}>
            却下する
          </button>
        </div>
      )}
      {approving && (
        <ApproveDialog
          r={r}
          pointsPerTicket={pointsPerTicket}
          onClose={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            onChanged();
          }}
        />
      )}
      {rejecting && (
        <RejectDialog
          r={r}
          onClose={() => setRejecting(false)}
          onDone={() => {
            setRejecting(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

/** 却下の確認。理由を選んでから却下する */
function RejectDialog({ r, onClose, onDone }: { r: RequestItem; onClose: () => void; onDone: () => void }) {
  const reasons = REJECT_REASONS[r.kind];
  const [reason, setReason] = useState<string>(reasons[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPost(`/requests/${r.id}/reject`, { reason });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="申請を却下する"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy} onClick={submit}>
            {busy ? '却下しています…' : '却下する'}
          </button>
        </>
      }
    >
      <p>
        <b>{r.household.displayName}</b>(<span className="mono">{r.household.memberNo}</span>)の{KIND_LABELS[r.kind]}
        を却下します。ポイントやおうちは変わりません。
      </p>
      <div className="field">
        <span className="label" id={`rq-reason-${r.id}`}>
          却下する理由
        </span>
        <div className="chips" role="radiogroup" aria-labelledby={`rq-reason-${r.id}`}>
          {reasons.map((x) => (
            <label key={x}>
              <input type="radio" name={`rq-reason-${r.id}`} checked={reason === x} onChange={() => setReason(x)} />
              <span>{x}</span>
            </label>
          ))}
        </div>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

/** ポイント数の入力欄の値を、0〜99 の整数として読む。読めなければ null */
function parsePoints(v: string): number | null {
  if (!/^\d{1,2}$/.test(v.trim())) return null;
  return Number(v.trim());
}

/** 移行元(LINEのショップカード / 紙のスタンプカード)を選ぶ */
function SourceChoice({
  value,
  onChange,
  done,
  name,
}: {
  value: MigrationSource | null;
  onChange: (s: MigrationSource) => void;
  /** 引き継ぎ済みの移行元(選べない) */
  done?: Partial<Record<MigrationSource, boolean>>;
  name: string;
}) {
  return (
    <div className="field">
      <span className="label" id={`${name}-label`}>
        旧カードの種類
      </span>
      <div className="chips" role="radiogroup" aria-labelledby={`${name}-label`}>
        {MIGRATION_SOURCES.map((s) => (
          <label key={s} className={done?.[s] ? 'rq-chip-off' : undefined}>
            <input type="radio" name={name} checked={value === s} disabled={done?.[s]} onChange={() => onChange(s)} />
            <span>
              {MIGRATION_SOURCE_LABELS[s]}
              {done?.[s] ? '(引き継ぎ済み)' : ''}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** 引き継ぎ後のポイントと無料券(承認・入力の前に見せる) */
function MigrationPreview({ balance, points, pointsPerTicket }: { balance: number; points: number | null; pointsPerTicket: number }) {
  if (points === null) return <p className="hint">ポイント数を 0〜99 の数字で入れてください。</p>;
  const plan = planMigration(balance, points, pointsPerTicket);
  return (
    <p className="rq-preview" role="status">
      いま {balance}ポイント → 引き継ぎ後 <b>{plan.balanceAfter}ポイント</b>
      {plan.ticketsIssued > 0 ? `(無料券を${plan.ticketsIssued}枚発行します)` : ''}
    </p>
  );
}

/** 旧カードの引き継ぎ申請の承認。写真を見て、ポイント数を確かめて(必要なら直して)承認する */
function ApproveDialog({
  r,
  pointsPerTicket,
  onClose,
  onDone,
}: {
  r: RequestItem;
  pointsPerTicket: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [source, setSource] = useState<MigrationSource | null>(r.migration?.source ?? null);
  const [pointsText, setPointsText] = useState(r.migration?.claimedPoints != null ? String(r.migration.claimedPoints) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const points = parsePoints(pointsText);
  const submit = async () => {
    if (points === null || !source) return;
    setBusy(true);
    setError(null);
    try {
      await adminPost(`/requests/${r.id}/approve`, { points, source });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="旧カードの引き継ぎを承認する"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || points === null || !source} onClick={submit}>
            {busy ? '承認しています…' : '承認する'}
          </button>
        </>
      }
    >
      <p>
        <b>{r.household.displayName}</b>(<span className="mono">{r.household.memberNo}</span>)の申請です。写真で旧カードのポイント数を確かめてください。
      </p>
      {r.attachmentUrl ? (
        <a className="rq-photo-large" href={r.attachmentUrl} target="_blank" rel="noreferrer" aria-label="旧カードの写真を大きく見る">
          <img src={r.attachmentUrl} alt="旧カードの写真" />
        </a>
      ) : (
        <p className="sub-text">写真が添付されていません。</p>
      )}
      {r.migration?.note && <p className="sub-text">お客さんのメモ: {r.migration.note}</p>}
      <SourceChoice value={source} onChange={setSource} name={`rq-src-${r.id}`} />
      <div className="field rq-points">
        <label htmlFor={`rq-points-${r.id}`}>引き継ぐポイント数</label>
        <input
          id={`rq-points-${r.id}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={pointsText}
          onChange={(e) => setPointsText(e.target.value)}
        />
        <span className="hint">
          申請は{r.migration?.claimedPoints != null ? `${r.migration.claimedPoints}ポイント` : 'ポイント数の記入なし'}。写真と違うときは直してください
        </span>
      </div>
      <MigrationPreview balance={r.household.points} points={points} pointsPerTicket={pointsPerTicket} />
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

/**
 * 受付での直接入力(16.1)。お客さんが受付で旧カードを見せたとき、おうちを探して選び、移行元とポイント数を入れる。
 * (おうちの詳細 M-06 に入れるまでの間、この画面に置く)
 */
function DirectMigration() {
  const { readOnly } = useAuth();
  const [picked, setPicked] = useState<HouseholdHit | null>(null);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [source, setSource] = useState<MigrationSource | null>(null);
  const [pointsText, setPointsText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<MigrationResult | null>(null);

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

  if (readOnly) {
    return (
      <div className="panel">
        <p className="empty">製作者のアカウントでは、旧カードの引き継ぎは入力できません。</p>
      </div>
    );
  }
  const points = parsePoints(pointsText);
  const done2 = status ? Object.fromEntries(MIGRATION_SOURCES.map((s) => [s, Boolean(status.migrated[s])])) : {};
  const allDone = status ? MIGRATION_SOURCES.every((s) => status.migrated[s]) : false;
  return (
    <section className="panel mg-section" aria-label="受付で直接入力">
      <p className="sub-text">
        お客さんが受付で旧カード(LINEのショップカード・紙のスタンプカード)を見せてくれたときに使います。おうちを選び、カードの種類とポイント数を入れて「引き継ぐ」を押してください。同じ種類のカードは、1つのおうちで1回だけ引き継げます。
      </p>
      {!picked ? (
        <HouseholdPicker label="引き継ぐおうちを探す" onPick={(h) => (setPicked(h), setDone(null), setPointsText(''))} />
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
                setDone(null);
                setError(null);
              }}
            >
              選び直す
            </button>
          </div>
          {done && (
            <p className="mg-done" role="status">
              {MIGRATION_SOURCE_LABELS[done.source]}の{done.points}ポイントを引き継ぎました。いまのポイントは{done.balance}ポイントです
              {done.ticketsIssued > 0 ? `(無料券を${done.ticketsIssued}枚発行しました)` : ''}。
            </p>
          )}
          {status && !status.inPeriod && (
            <div className="alert warning">
              <p>
                いまは旧カードの引き継ぎを受け付ける期間の外です({status.period.start ?? ''}〜{status.period.end ?? ''})。期間を変えるときは、ルールの設定で移行期間を直してください。
              </p>
            </div>
          )}
          {status && allDone ? (
            <p className="sub-text">このおうちは、両方の旧カードの引き継ぎが済んでいます。</p>
          ) : status ? (
            <>
              <SourceChoice value={source} onChange={setSource} done={done2} name="rq-direct-src" />
              <div className="field rq-points">
                <label htmlFor="rq-direct-points">旧カードのポイント数</label>
                <input
                  id="rq-direct-points"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="例: 7"
                  value={pointsText}
                  onChange={(e) => setPointsText(e.target.value)}
                />
              </div>
              <MigrationPreview balance={status.points} points={points} pointsPerTicket={status.pointsPerTicket} />
              <div className="mg-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={points === null || !source || !status.inPeriod}
                  onClick={() => setConfirming(true)}
                >
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
          pointsPerTicket={status.pointsPerTicket}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            setDone(r);
            setPointsText('');
            void load(picked.id);
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
  pointsPerTicket,
  onClose,
  onDone,
}: {
  household: HouseholdHit;
  source: MigrationSource;
  points: number;
  balance: number;
  pointsPerTicket: number;
  onClose: () => void;
  onDone: (r: MigrationResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const plan = planMigration(balance, points, pointsPerTicket);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await adminPost<MigrationResult>(`/households/${household.id}/migrate`, { source, points }));
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
            {busy ? '引き継いでいます…' : '引き継ぐ'}
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
          {plan.ticketsIssued > 0 ? `(無料券を${plan.ticketsIssued}枚発行します)` : ''}
        </li>
        <li>{MIGRATION_SOURCE_LABELS[source]}の引き継ぎは、このおうちではこの1回だけです</li>
        <li>間違えたときは、操作ログから元に戻せます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
