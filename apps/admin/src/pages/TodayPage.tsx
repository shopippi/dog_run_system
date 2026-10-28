import { CANCEL_REASONS, type AdminVisit, type TodayResponse } from '@dr/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { WalkinForm } from '../components/WalkinForm';
import { usePolling } from '../hooks/usePolling';
import { adminApi, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function formatDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return `${m}月${d}日(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** M-02 今日の来場(S-02)。管理画面のトップ。30秒ごとに自動で更新する */
export function TodayPage() {
  const { data, error, reload } = usePolling(() => adminApi<TodayResponse>('/today'), 30_000);
  const { readOnly } = useAuth();
  const seen = useRef<Set<number> | null>(null);
  const fresh = new Set<number>();
  if (data) {
    if (seen.current) for (const v of data.visits) if (!seen.current.has(v.id)) fresh.add(v.id);
  }
  useEffect(() => {
    if (data) seen.current = new Set(data.visits.map((v) => v.id));
  }, [data]);

  return (
    <div className="page">
      <PageHead
        title="今日の来場"
        sub={data ? formatDate(data.date) : undefined}
        howto="今日チェックインしたお客さんの一覧です。30秒ごとに新しい来場が上に出ます。無料券を使ったおうちは、料金を調整してください。"
        aside={
          data?.pendingRequests ? (
            <p className="pending" role="status">
              <Link to="/requests">
                確認待ちが <b>{data.pendingRequests}件</b> あります(旧カードの引き継ぎ・おうちをまとめる申請)
              </Link>
            </p>
          ) : null
        }
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        <p className="loading">読み込んでいます…</p>
      ) : (
        <>
          <section className="panel summary" aria-label="今日の集計">
            <div className="kpis">
              <Kpi label="来場組数" value={data.totals.groups} unit="組" />
              <Kpi label="ワンちゃん" value={data.totals.memberDogs + data.totals.walkinDogs} unit="頭" />
              <Kpi label="うち会員以外" value={data.totals.walkinDogs} unit="頭" />
              <Kpi label="無料券の使用" value={data.totals.ticketsUsed} unit="枚" />
            </div>
            {!readOnly && <WalkinForm onDone={reload} />}
          </section>
          <section className="panel list-panel">
            {data.visits.length === 0 ? (
              <p className="empty">まだ来場はありません。</p>
            ) : (
              <ul className="visits" aria-label="今日の来場">
                {data.visits.map((v) => (
                  <VisitRow key={v.id} v={v} fresh={fresh.has(v.id)} canEdit={!readOnly} onChanged={reload} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      <span className="v">
        {value}
        <small>{unit}</small>
      </span>
    </div>
  );
}

function VisitRow({
  v,
  fresh,
  canEdit,
  onChanged,
}: {
  v: AdminVisit;
  fresh: boolean;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const walkin = v.method === 'walkin';
  const [confirming, setConfirming] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  // 取り消すと行のボタンが消えるので、フォーカスは行そのものに移す
  const focusRowWhenCancelled = useRef(false);
  useEffect(() => {
    if (v.cancelled && focusRowWhenCancelled.current) {
      focusRowWhenCancelled.current = false;
      rowRef.current?.focus();
    }
  }, [v.cancelled]);
  const label = walkin ? `会員以外 ${v.dogCount}頭` : v.dogs.map((d) => d.name).join('・');
  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className={`visit${v.cancelled ? ' cancelled' : ''}${fresh ? ' new' : ''}`}
      aria-label={`${v.time} ${label}`}
    >
      <span className="t mono">{v.time}</span>
      <span className="stack">
        {walkin ? (
          <span className="walkin-mark" aria-hidden="true">
            <Icon name="users" size={18} />
          </span>
        ) : (
          v.dogs.map((d) => <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />)
        )}
      </span>
      <span className="visit-body">
        {walkin ? (
          <>
            <b>会員以外 {v.dogCount}頭</b>
            <span className="sub-text">受付で頭数を記録</span>
          </>
        ) : (
          <>
            <b>{v.dogs.map((d) => d.name).join('・')}</b>
            <span className="sub-text">
              {v.householdName}
              <span aria-hidden="true"> · </span>
              <span className="mono">{v.memberNo}</span>
              {v.checkedInBy ? (
                <>
                  <span aria-hidden="true"> · </span>
                  {v.checkedInBy}さん
                </>
              ) : null}
            </span>
          </>
        )}
      </span>
      <span className="badges">
        {v.usedTicket && !v.cancelled && <span className="badge warning">無料券を使用</span>}
        {v.method === 'proxy' && <span className="badge info">受付で代理</span>}
        {v.cancelled && <span className="badge">取り消し済み{v.cancelReason ? `(${v.cancelReason})` : ''}</span>}
      </span>
      <span className="visit-acts">
        {canEdit && !v.cancelled && (
          <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>
            取り消す
          </button>
        )}
      </span>
      {confirming && (
        <CancelConfirm
          v={v}
          label={label}
          onClose={() => setConfirming(false)}
          onDone={() => {
            focusRowWhenCancelled.current = true;
            setConfirming(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

/** 取り消しの確認(S-03)。何が元に戻るかを見せてから確定する(15.1) */
function CancelConfirm({
  v,
  label,
  onClose,
  onDone,
}: {
  v: AdminVisit;
  label: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPost(`/checkins/${v.id}/cancel`, { reason });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="チェックインを取り消す"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy} onClick={submit}>
            {busy ? '取り消しています…' : '取り消す'}
          </button>
        </>
      }
    >
      <p>
        <b>
          {v.time} {label}
        </b>{' '}
        のチェックインを取り消します。
      </p>
      <ul className="plain-list">
        {v.method !== 'walkin' && <li>付けたポイントを戻します</li>}
        {v.usedTicket && <li>この来場に結びついた無料券の使用を、使う前(未使用)に戻します</li>}
        <li>来場の記録は「取り消し済み」として残ります</li>
      </ul>
      <div className="field">
        <span className="label" id={`reason-${v.id}`}>
          取り消す理由
        </span>
        <div className="chips" role="radiogroup" aria-labelledby={`reason-${v.id}`}>
          {CANCEL_REASONS.map((r) => (
            <label key={r}>
              <input type="radio" name={`reason-${v.id}`} checked={reason === r} onChange={() => setReason(r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
