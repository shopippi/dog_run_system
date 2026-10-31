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
import { BusyLabel } from '../components/BusyLabel';
import { PageHead } from '../components/PageHead';
import { Loading, Skeleton, SkeletonCircle, SkeletonText } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { usePhotoSrc } from '../hooks/usePhotoSrc';
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
 * M-09 確認待ち(A-05)。以前に届いたお客さんからの申請を確かめて処理する。
 * - 旧カードの引き継ぎ申請: お客さんからの申請はやめた(16.1。受付で直接入力だけ。M-09 旧カードの引き継ぎ)。
 *   以前に届いた申請は却下だけできる(受付で旧カードを見せてもらうよう案内する)
 * - おうちをまとめるのは、お客さんが招待から自分でまとめる形になった(C-12)。「まとめる申請」は出さない
 * - 処理済みのタブで、承認・却下した申請を見られる
 */
export function RequestsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  return (
    <div className="page">
      <PageHead
        title="確認待ち"
        howto="以前にお客さんから届いた申請です。旧カードの引き継ぎの申請は承認できないので、「却下する」で理由を選んで処理し、お客さんには受付で旧カードを見せてもらって「旧カードの引き継ぎ」の画面で入力します。"
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
  if (!data) {
    return (
      <Loading>
        <section className="panel list-panel">
          <ul className="rq-list">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="rq-row">
                <div className="rq-meta">
                  <Skeleton w={120} h={22} r={6} />
                  <SkeletonText size={13} w={160} />
                </div>
                <div className="rq-body">
                  <div className="rq-house">
                    <SkeletonText size={12} w={40} />
                    <div className="rq-house-main">
                      <SkeletonCircle size={40} />
                      <span className="result-body">
                        <SkeletonText size={15} w={140} />
                        <SkeletonText size={13} w={88} />
                      </span>
                    </div>
                  </div>
                  <div className="rq-house">
                    <SkeletonText size={12} w={48} />
                    <div className="rq-house-main">
                      <Skeleton w={72} h={72} r={8} />
                      <span className="result-body">
                        <SkeletonText size={15} w={180} />
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </Loading>
    );
  }
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
            onChanged={reload}
          />
        ))}
      </ul>
    </section>
  );
}

/** 旧カードの写真。デモでは fetch で読んでから出す(usePhotoSrc) */
function CardPhoto({ url, large = false }: { url: string; large?: boolean }) {
  const src = usePhotoSrc(url);
  return (
    <a className={large ? 'rq-photo-large' : 'rq-photo'} href={src ?? url} target="_blank" rel="noreferrer" aria-label="旧カードの写真を大きく見る">
      {src ? large ? <img src={src} alt="旧カードの写真" /> : <img src={src} alt="旧カードの写真" width={72} height={72} /> : null}
    </a>
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
  onChanged,
}: {
  r: RequestItem;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const toast = useToast();
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
                <CardPhoto url={r.attachmentUrl} />
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
            toast(`${r.household.displayName}の${KIND_LABELS[r.kind]}を却下しました。`);
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
            <BusyLabel busy={busy} pending="却下しています…">
              却下する
            </BusyLabel>
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
