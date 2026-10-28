import { useState } from 'react';
import { adminPost } from '../lib/api';
import { ErrorNotice } from './ErrorNotice';

/** 会員以外のお客さんの頭数を記録する(S-05)。LINE を使わないお客さんは、受付で頭数だけを入れる */
export function WalkinForm({ onDone }: { onDone: () => void }) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<number | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPost('/walkins', { dogCount: count });
      setDone(count);
      setCount(1);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel walkin" aria-label="会員以外のお客さん">
      <div className="walkin-row">
        <b>会員以外のお客さん</b>
        <div className="stepper" role="group" aria-label="頭数">
          <button type="button" className="btn sub small" aria-label="1頭へらす" disabled={count <= 1} onClick={() => setCount((n) => n - 1)}>
            −
          </button>
          <span className="count" aria-live="polite">
            {count}頭
          </span>
          <button type="button" className="btn sub small" aria-label="1頭ふやす" disabled={count >= 30} onClick={() => setCount((n) => n + 1)}>
            ＋
          </button>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={submit}>
          {busy ? '記録しています…' : '記録する'}
        </button>
      </div>
      {done !== null && !error && (
        <p className="small muted" role="status">
          会員以外のお客さん {done}頭 を記録しました。
        </p>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </section>
  );
}
