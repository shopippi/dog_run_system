import { EXPORTS, EXPORT_NAMES, exportQuerySchema, type ExportName } from '@dr/shared';
import { useId, useState } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { ApiError } from '../lib/api';

/** CSV を受け取る(エラーのときは、API のエラーの文を出す) */
async function download(name: ExportName, from: string, to: string): Promise<string> {
  const q = new URLSearchParams();
  if (EXPORTS[name].period) {
    if (from) q.set('from', from);
    if (to) q.set('to', to);
  }
  let res: Response;
  try {
    const qs = q.toString();
    res = await fetch(`/admin/api/export/${name}${qs ? `?${qs}` : ''}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'インターネットにつながっていないようです。接続を確かめて、もう一度お試しください。');
  }
  if (!res.ok) {
    let message = 'CSVを作れませんでした。少し待ってから、もう一度お試しください。';
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // 本文がなくてもよい
    }
    throw new ApiError(res.status, 'export_failed', message);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : `${name}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  // すぐに消すと、ブラウザによってはファイル名が使われないので、少し待ってから片づける
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
  return filename;
}

/**
 * M-18 CSV出力(A-14)。種類と期間を選んでダウンロードする。Excel でそのまま開ける。
 * LINE の名前やアンケートの回答が入るので、ファイルの扱いに気をつける。
 */
export function ExportPage() {
  const [name, setName] = useState<ExportName>('visits');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState('');
  const labelId = useId();
  const fromId = useId();
  const toId = useId();
  const info = EXPORTS[name];

  const submit = async () => {
    setError(null);
    setDone('');
    if (info.period) {
      const checked = exportQuerySchema.safeParse({ from: from || undefined, to: to || undefined });
      if (!checked.success) {
        setError(new ApiError(400, 'bad_request', checked.error.issues[0]?.message ?? '期間を選び直してください。'));
        return;
      }
    }
    setBusy(true);
    try {
      const file = await download(name, from, to);
      setDone(`「${file}」をダウンロードしました。`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page cfg-page">
      <PageHead
        title="CSV出力"
        howto="出したいデータを選んで「ダウンロード」を押してください。Excelでそのまま開けます。LINEの名前やアンケートの回答が入るので、ファイルは外に渡さないでください。出力したことは操作ログに残ります。"
      />
      <section className="panel cfg-add" aria-label="CSVを作る">
        <div className="field">
          <span className="label" id={labelId}>
            出すデータ
          </span>
          <div className="chips" role="radiogroup" aria-labelledby={labelId}>
            {EXPORT_NAMES.map((n) => (
              <label key={n}>
                <input type="radio" name="export" checked={name === n} onChange={() => setName(n)} />
                <span>{EXPORTS[n].label}</span>
              </label>
            ))}
          </div>
          <span className="hint">{info.desc}</span>
        </div>
        {info.period ? (
          <div className="cfg-row">
            <div className="field">
              <label htmlFor={fromId}>期間の始め</label>
              <input id={fromId} type="date" className="cfg-date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={toId}>期間の終わり</label>
              <input id={toId} type="date" className="cfg-date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <p className="hint cfg-period-hint">空欄のときは、すべての期間を出します。</p>
          </div>
        ) : (
          <p className="sub-text">このデータは、いまの内容をすべて出します(期間の指定はありません)。</p>
        )}
        {error ? <ErrorNotice error={error} /> : null}
        <div className="cfg-acts">
          <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>
            <Icon name="download" />
            {busy ? '作っています…' : 'ダウンロード'}
          </button>
        </div>
        <p className="sub-text" role="status">
          {done}
        </p>
      </section>
    </div>
  );
}
