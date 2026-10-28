import type { AdminVisit, TodayResponse } from '@dr/shared';
import { useEffect, useRef } from 'react';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { usePolling } from '../hooks/usePolling';
import { adminApi } from '../lib/api';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function formatDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return `${m}月${d}日(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** M-02 今日の来場(S-02)。管理画面のトップ。30秒ごとに自動で更新する */
export function TodayPage() {
  const { data, error, reload } = usePolling(() => adminApi<TodayResponse>('/today'), 30_000);
  const seen = useRef<Set<number> | null>(null);
  const fresh = new Set<number>();
  if (data) {
    if (seen.current) for (const v of data.visits) if (!seen.current.has(v.id)) fresh.add(v.id);
  }
  useEffect(() => {
    if (data) seen.current = new Set(data.visits.map((v) => v.id));
  }, [data]);

  return (
    <main className="con-body">
      <p className="howto">
        今日チェックインしたお客さんの一覧です。30秒ごとに新しい来場が上に出ます。無料券を使ったおうちは、料金を調整してください。
      </p>
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        <p className="loading">読み込んでいます…</p>
      ) : (
        <>
          {data.pendingRequests ? (
            <div className="notice gold-notice" role="status">
              確認待ちが <b>{data.pendingRequests}件</b> あります(旧カードの引き継ぎ・おうちをまとめる申請)
            </div>
          ) : null}
          <div className="today-head">
            <h2>{formatDate(data.date)}の来場</h2>
          </div>
          <div className="kpis">
            <Kpi label="来場組数" value={`${data.totals.groups}組`} />
            <Kpi label="ワンちゃん" value={`${data.totals.memberDogs + data.totals.walkinDogs}頭`} />
            <Kpi label="うち会員以外" value={`${data.totals.walkinDogs}頭`} />
            <Kpi label="無料券の使用" value={`${data.totals.ticketsUsed}枚`} />
          </div>
          {data.visits.length === 0 ? (
            <p className="empty">まだ来場はありません。</p>
          ) : (
            <ul className="visits" aria-label="今日の来場">
              {data.visits.map((v) => (
                <VisitRow key={v.id} v={v} fresh={fresh.has(v.id)} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

function VisitRow({ v, fresh }: { v: AdminVisit; fresh: boolean }) {
  const walkin = v.method === 'walkin';
  return (
    <li className={`visit${v.cancelled ? ' cancelled' : ''}${fresh ? ' new' : ''}`}>
      <span className="t mono">{v.time}</span>
      <span className="faces">
        {walkin ? (
          <span className="walkin-mark" aria-hidden="true">
            {v.dogCount}
          </span>
        ) : (
          v.dogs.map((d) => <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={56} />)
        )}
      </span>
      <span className="visit-body">
        {walkin ? (
          <b>会員以外 {v.dogCount}頭</b>
        ) : (
          <>
            <b>{v.dogs.map((d) => d.name).join('・')}</b>
            <span className="small muted">
              {v.householdName}・<span className="mono">{v.memberNo}</span>
              {v.checkedInBy ? `・${v.checkedInBy}さん` : ''}
            </span>
          </>
        )}
        <span className="pills">
          {v.usedTicket && !v.cancelled && <span className="pill o">無料券を使用</span>}
          {v.method === 'proxy' && <span className="pill">受付で代理</span>}
          {v.cancelled && <span className="pill r">取り消し済み{v.cancelReason ? `(${v.cancelReason})` : ''}</span>}
        </span>
      </span>
    </li>
  );
}
