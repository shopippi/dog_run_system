import type { AuditEntry, AuditListResponse } from '@dr/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { BusyLabel } from '../components/BusyLabel';
import { PageHead } from '../components/PageHead';
import { Loading, SkeletonGhost, SkeletonText } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useLoad } from '../hooks/useLoad';
import { adminApi, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/jst-format';

type Filter = { from: string; to: string; action: string; page: number };

/**
 * M-15 操作ログ(A-15)。誰が・いつ・何を変えたかの一覧。新しい順。
 * 元に戻せる操作には「元に戻す」を出し、確認してから戻す。戻した行は「元に戻し済み」。
 */
export function AuditPage() {
  const { readOnly } = useAuth();
  const [filter, setFilter] = useState<Filter>({ from: '', to: '', action: '', page: 1 });
  const [target, setTarget] = useState<AuditEntry | null>(null);
  const toast = useToast();
  const { data, error, reload } = useLoad(() => {
    const p = new URLSearchParams();
    if (filter.from) p.set('from', filter.from);
    if (filter.to) p.set('to', filter.to);
    if (filter.action) p.set('action', filter.action);
    if (filter.page > 1) p.set('page', String(filter.page));
    return adminApi<AuditListResponse>(`/audit?${p.toString()}`);
  }, [filter.from, filter.to, filter.action, filter.page]);

  const set = (patch: Partial<Filter>) => {
    setFilter((f) => ({ ...f, page: 1, ...patch }));
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="page">
      <PageHead
        title="操作ログ"
        howto="管理画面で、誰が・いつ・何を変えたかの一覧です。新しい操作が上に出ます。間違えた操作は「元に戻す」で戻せます(戻した操作も、ここに残ります)。"
      />
      <div className="audit-filter" role="group" aria-label="絞り込み">
        <div className="field">
          <label htmlFor="audit-from">この日から</label>
          <input id="audit-from" type="date" value={filter.from} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="audit-to">この日まで</label>
          <input id="audit-to" type="date" value={filter.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="audit-action">操作の種類</label>
          <select id="audit-action" value={filter.action} onChange={(e) => set({ action: e.target.value })}>
            <option value="">すべての操作</option>
            {data?.actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        error ? null : <AuditSkeleton />
      ) : (
        <section className="panel list-panel">
          {data.entries.length === 0 ? (
            <p className="empty">この条件の操作はありません。</p>
          ) : (
            <ul className="audit-list" aria-label="操作の一覧">
              <AuditHead />
              {data.entries.map((e) => (
                <AuditRowView key={e.id} e={e} canEdit={!readOnly} onUndo={() => setTarget(e)} />
              ))}
            </ul>
          )}
          {data.total > data.pageSize && (
            <nav className="audit-pager" aria-label="ページ">
              <button
                type="button"
                className="btn sub"
                disabled={filter.page <= 1}
                onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
              >
                新しい方へ
              </button>
              <span className="sub-text">
                {data.total}件中 {(data.page - 1) * data.pageSize + 1}〜{Math.min(data.total, data.page * data.pageSize)}件目
              </span>
              <button
                type="button"
                className="btn sub"
                disabled={filter.page >= pages}
                onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
              >
                古い方へ
              </button>
            </nav>
          )}
        </section>
      )}
      {target && (
        <UndoConfirm
          e={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            toast(`「${target.actionLabel}」を元に戻しました。`);
            setTarget(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

/** 一覧の見出し(列の名前)。スクロールしても上に残る */
function AuditHead() {
  return (
    <li className="audit-row audit-head list-head" aria-hidden="true">
      <span>日時</span>
      <span>操作と対象</span>
      <span>した人</span>
      <span />
    </li>
  );
}

/** 読み込み中: 見出しと、操作の行 6 つ */
function AuditSkeleton() {
  return (
    <Loading>
      <section className="panel list-panel">
        <ul className="audit-list">
          <AuditHead />
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="audit-row">
              <span className="audit-at">
                <SkeletonText size={13} lh={1.4} w={72} />
                <SkeletonText size={13} lh={1.4} w={40} />
              </span>
              <span className="audit-body">
                <SkeletonText size={15} w={[140, 120, 180, 100, 150, 130][i]} />
                <SkeletonText size={14} w={[200, 160, 220, 180, 140, 210][i]} />
              </span>
              <SkeletonText size={13} w={56} />
              <span className="audit-acts">{i % 2 === 0 ? <SkeletonGhost w={56} /> : null}</span>
            </li>
          ))}
        </ul>
      </section>
    </Loading>
  );
}

function AuditRowView({ e, canEdit, onUndo }: { e: AuditEntry; canEdit: boolean; onUndo: () => void }) {
  const [date, time] = formatDateTime(e.at).split(' ');
  return (
    <li className={`audit-row${e.undone ? ' undone' : ''}`} aria-label={`${formatDateTime(e.at)} ${e.actionLabel}`}>
      <span className="audit-at mono">
        <span>{date}</span>
        <span>{time}</span>
      </span>
      <span className="audit-body">
        <b>{e.actionLabel}</b>
        <span className="audit-target">
          {e.target.householdId ? <Link to={`/households/${e.target.householdId}`}>{e.target.label}</Link> : e.target.label}
          {e.target.code && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="mono">{e.target.code}</span>
            </>
          )}
        </span>
        {(e.detail || e.reason) && (
          <span className="sub-text">
            {e.detail}
            {e.detail && e.reason ? <span aria-hidden="true"> · </span> : null}
            {e.reason ? `理由: ${e.reason}` : null}
          </span>
        )}
      </span>
      <span className="audit-who sub-text">{e.actorName}</span>
      <span className="audit-acts">
        {e.undone ? (
          <span className="badge" title={`${formatDateTime(e.undone.at)} ${e.undone.byName}`}>
            元に戻し済み
          </span>
        ) : canEdit && e.canUndo ? (
          <button type="button" className="btn ghost" onClick={onUndo}>
            元に戻す
          </button>
        ) : null}
      </span>
    </li>
  );
}

/** 元に戻す前の確認(A-15)。何を戻すかを見せてから確定する */
function UndoConfirm({ e, onClose, onDone }: { e: AuditEntry; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPost(`/audit/${e.id}/undo`);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="操作を元に戻す"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy} onClick={submit}>
            <BusyLabel busy={busy} pending="戻しています…">
              元に戻す
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        {formatDateTime(e.at)} の <b>{e.actionLabel}</b>({e.target.label})を、操作の前の状態に戻します。
      </p>
      <ul className="plain-list">
        {e.detail && <li>戻す操作の内容: {e.detail}</li>}
        <li>元に戻したことも、操作ログに残ります</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
