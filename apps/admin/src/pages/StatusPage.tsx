import {
  STATUS_LEVEL_LABELS,
  type JobRunResult,
  type StatusLevel,
  type SystemJobRun,
  type SystemStatusResponse,
} from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHead } from '../components/PageHead';
import { adminApi, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

// M-17 システムの状態(A-17 簡易・D-02 詳細)。管理者は簡易(色と「今すぐ実行」)、製作者は詳細も見られる。

function when(iso: string | null) {
  if (!iso) return 'まだありません';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [hh, mm] = iso.slice(11, 16).split(':') as [string, string];
  return `${m}月${d}日 ${Number(hh)}:${mm}`;
}
const STATUS_WORDS: Record<SystemJobRun['status'], string> = { running: '動いています', ok: 'できました', warning: '一部だけ', failed: 'うまくいきませんでした' };
function bytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.ceil(n / 1024)}KB`;
}
const share = (n: number, limit: number) => `${Math.max(n > 0 ? 0.1 : 0, Math.round((n / limit) * 1000) / 10)}%`;

export function StatusPage() {
  const { readOnly } = useAuth();
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setData(await adminApi<SystemStatusResponse>('/system-status'));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHead
        title="システムの状態"
        howto="天気の取得やバックアップなど、自動で動く処理がうまく動いているかを色で表示します。青は正常、黄は注意(多くは次の実行で自動でやり直します)、赤は止まっています。赤のときは製作者に連絡してください。"
      />
      {error ? <ErrorNotice error={error} onRetry={() => void load()} /> : null}
      {!data ? (
        !error && <p className="loading">読み込んでいます…</p>
      ) : (
        <>
          {data.overall === 'red' && (
            <div className="alert danger" role="alert">
              <p>
                止まっている処理があります。お客さんのチェックインはそのまま使えます。製作者に連絡してください。
                {data.contact ? `連絡先: ${data.contact}` : '連絡先は「使い方・困ったとき」の画面にあります。'}
              </p>
            </div>
          )}
          <section className="panel list-panel" aria-label="自動で動く処理">
            <ul className="status-list">
              {data.jobs.map((j) => (
                <JobRow key={j.name} job={j} canRun={!readOnly && j.runnable} onDone={load} />
              ))}
            </ul>
          </section>
          <p className="note">{when(data.checkedAt)} の時点の状態です。</p>
          {data.detail && <Detail detail={data.detail} />}
        </>
      )}
    </div>
  );
}

function Level({ level }: { level: StatusLevel }) {
  return (
    <span className={`status-level ${level}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LEVEL_LABELS[level]}
    </span>
  );
}

function JobRow({
  job,
  canRun,
  onDone,
}: {
  job: SystemStatusResponse['jobs'][number];
  canRun: boolean;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JobRunResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await adminPost<JobRunResult>(`/system/run/${job.name}`));
      await onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="status-row" aria-label={`${job.label} ${STATUS_LEVEL_LABELS[job.level]}`}>
      <Level level={job.level} />
      <span className="status-body">
        <b>{job.label}</b>
        <span className="sub-text">
          {job.schedule}
          <span aria-hidden="true"> · </span>
          最後の実行 {when(job.lastRun?.startedAt ?? null)}
          {job.lastRun ? `(${STATUS_WORDS[job.lastRun.status]})` : ''}
        </span>
        <span className="status-summary">{job.summary}</span>
        {job.lastRun?.message && !result && <span className="status-message">{job.lastRun.message}</span>}
        {result && (
          <span className="status-result" role="status">
            今すぐ実行の結果: {result.message}
          </span>
        )}
        {error ? <ErrorNotice error={error} /> : null}
      </span>
      <span className="status-acts">
        {canRun && (
          <button type="button" className="btn sub" disabled={busy} onClick={run}>
            {busy ? '実行しています…' : '今すぐ実行'}
          </button>
        )}
      </span>
    </li>
  );
}

function Detail({ detail }: { detail: NonNullable<SystemStatusResponse['detail']> }) {
  return (
    <>
      <section className="panel status-panel" aria-label="保存容量の見込み">
        <h2>保存容量の見込み</h2>
        <div className="dash-kpis dash-kpis-3">
          <div className="kpi">
            <span className="l">写真(犬・引き継ぎ申請)</span>
            <span className="v">
              {detail.photos.count.toLocaleString('ja-JP')}
              <small>枚</small>
            </span>
            <span className="dash-kpi-note">
              約{bytes(detail.photos.estimatedBytes)}(1枚150KBで計算)· 無料枠{bytes(detail.photos.limitBytes)}の{share(detail.photos.estimatedBytes, detail.photos.limitBytes)}
            </span>
          </div>
          <div className="kpi">
            <span className="l">記録の保存場所</span>
            <span className="v">{detail.databaseBytes === null ? '—' : bytes(detail.databaseBytes)}</span>
            <span className="dash-kpi-note">
              上限{bytes(detail.databaseLimitBytes)}
              {detail.databaseBytes === null ? '' : `の${share(detail.databaseBytes, detail.databaseLimitBytes)}`}
            </span>
          </div>
          <div className="kpi">
            <span className="l">来場の記録</span>
            <span className="v">
              {(detail.tables.find((t) => t.name === 'visits')?.rows ?? 0).toLocaleString('ja-JP')}
              <small>件</small>
            </span>
            <span className="dash-kpi-note">想定の規模は10万件まで</span>
          </div>
        </div>
      </section>

      <section className="panel status-panel" aria-label="うまくいかなかった処理">
        <h2>うまくいかなかった処理(直近10件)</h2>
        {detail.recentFailures.length === 0 ? (
          <p className="empty">うまくいかなかった処理はありません。</p>
        ) : (
          <RunTable runs={detail.recentFailures} />
        )}
      </section>

      <section className="panel status-panel" aria-label="自動処理の実行の履歴">
        <h2>自動処理の実行の履歴(直近30件)</h2>
        {detail.history.length === 0 ? <p className="empty">まだ動いていません。</p> : <RunTable runs={detail.history} />}
      </section>

      <section className="panel status-panel" aria-label="記録の件数">
        <h2>記録の件数</h2>
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th scope="col">中身</th>
                <th scope="col">表の名前(製作者向け)</th>
                <th scope="col" className="n">
                  件数
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.tables.map((t) => (
                <tr key={t.name}>
                  <td>{t.label}</td>
                  <td className="mono">{t.name}</td>
                  <td className="n">{t.rows.toLocaleString('ja-JP')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function RunTable({ runs }: { runs: SystemJobRun[] }) {
  return (
    <div className="dash-table-wrap">
      <table className="dash-table status-runs">
        <thead>
          <tr>
            <th scope="col">始まり</th>
            <th scope="col">処理</th>
            <th scope="col">結果</th>
            <th scope="col">内容</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => (
            <tr key={`${r.startedAt}-${r.name}-${i}`}>
              <td>{when(r.startedAt)}</td>
              <td>{r.label}</td>
              <td>{STATUS_WORDS[r.status]}</td>
              <td className="status-msg-cell">{r.message ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
