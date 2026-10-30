import type { SettingsResponse } from '@dr/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { useToast } from '../components/Toast';
import { SWITCHOVER_PHASES, announcementText } from '../content/switchover';
import { useFacilityName } from '../hooks/useFacilityName';
import { adminApi } from '../lib/api';

const KEY = 'dr.switchover.done';

function readDone(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * M-19 切り替えの手順(要件定義書 16.2・16.3、A-16)。旧カードから新しい会員証へ切り替える日の前後にすることの一覧。
 * 済んだ印は、この端末だけに覚える(覚えられない端末では、開き直すと消える)。
 */
export function SwitchoverPage() {
  const facility = useFacilityName();
  const toast = useToast();
  const [done, setDone] = useState<Record<string, boolean>>(readDone);
  const [period, setPeriod] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  useEffect(() => {
    adminApi<SettingsResponse>('/settings')
      .then((r) => setPeriod(r.settings.migration_period))
      .catch(() => undefined); // 期間が読めなくても、文の例は「○月○日」で出す
  }, []);
  const toggle = (id: string, v: boolean) => {
    const next = { ...done, [id]: v };
    setDone(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // 覚えられなくても、この画面では印を付けたままにする
    }
  };
  const text = announcementText(facility, period);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('お知らせの文を写しました。LINEの管理画面に貼り付けてください。');
    } catch {
      toast('写せませんでした。文を長押し(または選んで)写してください。');
    }
  };
  const total = SWITCHOVER_PHASES.reduce((n, p) => n + p.steps.length, 0);
  const count = SWITCHOVER_PHASES.reduce((n, p) => n + p.steps.filter((s) => done[s.id]).length, 0);
  return (
    <div className="page">
      <PageHead
        title="切り替えの手順"
        crumbs={[{ label: '旧カードの引き継ぎ', to: '/migration' }, { label: '切り替えの手順' }]}
        howto="LINEのショップカードと紙のカードから、新しい会員証へ切り替えるときにすることの一覧です。済んだものに印を付けてください(印はこの端末に残ります)。"
        aside={<span className="sub-text">{`${count} / ${total} 済み`}</span>}
      />
      {SWITCHOVER_PHASES.map((phase) => (
        <section key={phase.title} className="panel mg-section" aria-label={phase.title}>
          <div className="mi-sum-head">
            <h2 className="mg-title">{phase.title}</h2>
            <span className="sub-text">{phase.when}</span>
          </div>
          <ul className="sw-list">
            {phase.steps.map((s) => (
              <li key={s.id} className={done[s.id] ? 'sw-step done' : 'sw-step'}>
                <label className="check sw-check">
                  <input type="checkbox" checked={!!done[s.id]} onChange={(e) => toggle(s.id, e.target.checked)} />
                  <b>{s.title}</b>
                </label>
                {(s.detail || s.link || s.caution) && (
                  <div className="sw-body">
                    {s.detail?.map((p) => (
                      <p key={p} className="sub-text">
                        {p}
                      </p>
                    ))}
                    {s.caution && (
                      <div className="alert danger">
                        <p>{s.caution}</p>
                      </div>
                    )}
                    {s.link && (
                      <Link className="sw-link" to={s.link.to}>
                        {s.link.label}
                      </Link>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="panel mg-section" aria-label="お知らせの文の例">
        <div className="mi-sum-head">
          <h2 className="mg-title">お知らせの文の例</h2>
          <button type="button" className="btn sub" onClick={copy}>
            文を写す
          </button>
        </div>
        <p className="sub-text">LINEの一斉配信や店頭のPOPに使えます。日付は「ルールの設定」の移行期間から入ります。</p>
        <pre className="sw-text" aria-label="お知らせの文">
          {text}
        </pre>
      </section>
    </div>
  );
}
