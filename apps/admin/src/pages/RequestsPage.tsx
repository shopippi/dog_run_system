import {
  MIGRATION_SOURCE_LABELS,
  REJECT_REASONS,
  type RequestHousehold,
  type RequestItem,
  type RequestListResponse,
} from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHead } from '../components/PageHead';
import { adminApi, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

type Tab = 'pending' | 'handled';

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
 * - 処理済みのタブで、承認・却下した申請を見られる
 */
export function RequestsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  return (
    <div className="page">
      <PageHead
        title="確認待ち"
        howto="お客さんからの申請です。おうちをまとめる申請は「統合の画面に進む」から、同じワンちゃんを写真で確かめてまとめてください。違うときは「却下する」を押して理由を選びます。"
      />
      <div className="segment rq-tabs" role="tablist" aria-label="表示する申請">
        <button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
          確認待ち
        </button>
        <button type="button" role="tab" aria-selected={tab === 'handled'} onClick={() => setTab('handled')}>
          処理済み
        </button>
      </div>
      <RequestList key={tab} tab={tab} />
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
          <RequestRow key={r.id} r={r} canEdit={!readOnly && tab === 'pending'} onChanged={reload} />
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

function RequestRow({ r, canEdit, onChanged }: { r: RequestItem; canEdit: boolean; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState(false);
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
                <b>{r.migration ? `${MIGRATION_SOURCE_LABELS[r.migration.source]} ${r.migration.claimedPoints}ポイント` : '申請の内容を読めません'}</b>
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
          <button type="button" className="btn ghost" onClick={() => setRejecting(true)}>
            却下する
          </button>
        </div>
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
