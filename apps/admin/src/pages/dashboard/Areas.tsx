import type { AreaRow, DashboardResponse, JobRunResult } from '@dr/shared';
import { Fragment, useState } from 'react';
import { BusyLabel } from '../../components/BusyLabel';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { adminPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { num } from './format';
import { Panel, type PanelCsv } from './parts';

// どこから来ているか(docs/design.md 12.3)。郵便番号から調べた市区町村ごとの、おうちの数と来場の数。
// 上位 8 + そのほか + 郵便番号なし。行を押すと町域まで開く。

const TOP = 8;

export function AreasPanel({ data, onLookedUp }: { data: DashboardResponse; onLookedUp: () => void }) {
  const a = data.areas;
  const { staff } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const top = a.rows.slice(0, TOP);
  const rest = a.rows.slice(TOP);
  const other = rest.length ? { households: rest.reduce((s, r) => s + r.households, 0), visits: rest.reduce((s, r) => s + r.visits, 0) } : null;
  const unknown = {
    households: a.noPostal.households + a.notFound.households,
    visits: a.noPostal.visits + a.notFound.visits,
  };
  const totalVisits = a.rows.reduce((s, r) => s + r.visits, 0) + unknown.visits + a.pending.visits;
  const max = Math.max(1, ...top.map((r) => r.visits), other?.visits ?? 0, unknown.visits, a.pending.visits);
  const share = (v: number) => (totalVisits ? `${Math.round((v / totalVisits) * 100)}%` : '—');

  const lookup = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await adminPost<JobRunResult>('/system/run/postal_areas');
      toast(res.message);
      onLookedUp();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const bar = (v: number) => <span className="dsb-bar" style={{ width: `${(v / max) * 100}%` }} aria-hidden="true" />;
  const empty = a.rows.length === 0 && unknown.households === 0 && a.pending.households === 0;

  return (
    <Panel
      title="どこから来ているか"
      note="期間中に来場したおうちを、郵便番号から調べた市区町村ごとに数えています。来場は来た回数です。行を押すと町域まで開きます。"
      wide
      csv={(): PanelCsv => ({
        unit: '町域ごとに1行',
        columns: [
          { name: '都道府県', desc: '郵便番号から調べた都道府県' },
          { name: '市区町村', desc: '郵便番号から調べた市区町村' },
          { name: '町域', desc: '郵便番号から調べた町域(市区町村の合計の行は空)' },
          { name: 'おうち(軒)', desc: '期間中に来場したおうちの数' },
          { name: '来場(回)', desc: '期間中に来場した回数(取り消し・臨時休業日を除く)' },
        ],
        rows: [
          ...a.rows.flatMap((r) => [
            [r.prefecture, r.city, '', r.households, r.visits],
            ...r.towns.map((t) => [r.prefecture, r.city, t.town, t.households, t.visits]),
          ]),
          ['', '郵便番号なし・見つからない', '', unknown.households, unknown.visits],
          ['', 'まだ調べていない', '', a.pending.households, a.pending.visits],
        ],
        notes: ['郵便番号そのものは入れていません。地域は郵便番号の検索サービス(zipcloud)で調べたものです。'],
      })}
    >
      {empty ? (
        <p className="empty">この期間に来場したおうちはありません。</p>
      ) : (
        <table className="dsb-bars dsb-areas" aria-label="市区町村ごとのおうちと来場">
          <thead>
            <tr>
              <th scope="col">市区町村</th>
              <th scope="col" className="n">
                おうち
              </th>
              <th scope="col" className="n">
                来場
              </th>
              <th scope="col" className="n dsb-pct">
                割合
              </th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <AreaRows key={r.key} r={r} open={open === r.key} toggle={() => setOpen(open === r.key ? null : r.key)} bar={bar} share={share} />
            ))}
            {other && (
              <tr className="dsb-muted">
                <th scope="row">
                  {bar(other.visits)}
                  <span className="dsb-bar-label">そのほか({rest.length}市区町村)</span>
                </th>
                <td className="n">{num(other.households)}軒</td>
                <td className="n">{num(other.visits)}回</td>
                <td className="n dsb-pct">{share(other.visits)}</td>
              </tr>
            )}
            {unknown.households > 0 && (
              <tr className="dsb-muted">
                <th scope="row">
                  {bar(unknown.visits)}
                  <span className="dsb-bar-label">郵便番号なし{a.notFound.households ? '・見つからない' : ''}</span>
                </th>
                <td className="n">{num(unknown.households)}軒</td>
                <td className="n">{num(unknown.visits)}回</td>
                <td className="n dsb-pct">{share(unknown.visits)}</td>
              </tr>
            )}
            {a.pending.households > 0 && (
              <tr className="dsb-muted">
                <th scope="row">
                  {bar(a.pending.visits)}
                  <span className="dsb-bar-label">まだ調べていない郵便番号({a.pending.codes}件)</span>
                </th>
                <td className="n">{num(a.pending.households)}軒</td>
                <td className="n">{num(a.pending.visits)}回</td>
                <td className="n dsb-pct">{share(a.pending.visits)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {a.pending.households > 0 && (
        <div className="dsb-areas-foot">
          <p className="dsb-note">まだ調べていない郵便番号は、毎晩3時すぎに自動で調べます。</p>
          {staff?.role === 'admin' && (
            <button type="button" className="btn sub" disabled={busy} onClick={() => void lookup()}>
              <BusyLabel busy={busy} pending="調べています…">
                今すぐ調べる
              </BusyLabel>
            </button>
          )}
        </div>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </Panel>
  );
}

function AreaRows({
  r,
  open,
  toggle,
  bar,
  share,
}: {
  r: AreaRow;
  open: boolean;
  toggle: () => void;
  bar: (v: number) => JSX.Element;
  share: (v: number) => string;
}) {
  return (
    <Fragment>
      <tr className="dsb-area-row">
        <th scope="row">
          {bar(r.visits)}
          <button type="button" className="dsb-area-btn" aria-expanded={open} onClick={toggle}>
            <span className={`dsb-chev${open ? ' open' : ''}`} aria-hidden="true">
              <Icon name="chevron-right" size={14} />
            </span>
            <span className="dsb-bar-label">
              {r.city}
              <span className="dsb-pref">{r.prefecture}</span>
            </span>
          </button>
        </th>
        <td className="n">{num(r.households)}軒</td>
        <td className="n">{num(r.visits)}回</td>
        <td className="n dsb-pct">{share(r.visits)}</td>
      </tr>
      {open &&
        r.towns.map((t) => (
          <tr key={t.town} className="dsb-town">
            <th scope="row">
              <span className="dsb-bar-label">{t.town}</span>
            </th>
            <td className="n">{num(t.households)}軒</td>
            <td className="n">{num(t.visits)}回</td>
            <td className="n dsb-pct">{share(t.visits)}</td>
          </tr>
        ))}
    </Fragment>
  );
}
