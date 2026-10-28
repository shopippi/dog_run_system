import { useState } from 'react';
import { adminPost } from '../lib/api';
import { ErrorNotice } from './ErrorNotice';
import { Icon } from './Icon';

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
    <section className="walkin" aria-label="会員以外のお客さん">
      <div className="walkin-row">
        <div className="walkin-label">
          <b>会員以外のお客さん</b>
          <span className="sub-text">LINEを使わないお客さんは、頭数だけを記録します</span>
        </div>
        <div className="stepper" role="group" aria-label="頭数">
          <button type="button" className="btn sub icon-btn" aria-label="1頭へらす" disabled={count <= 1} onClick={() => setCount((n) => n - 1)}>
            <Icon name="minus" />
          </button>
          <span className="count" aria-live="polite">
            {count}頭
          </span>
          <button type="button" className="btn sub icon-btn" aria-label="1頭ふやす" disabled={count >= 30} onClick={() => setCount((n) => n + 1)}>
            <Icon name="plus" />
          </button>
        </div>
        <button type="button" className="btn sub" disabled={busy} onClick={submit}>
          {busy ? '記録しています…' : '記録する'}
        </button>
      </div>
      {done !== null && !error && (
        <p className="walkin-done" role="status">
          会員以外のお客さん {done}頭 を記録しました。
        </p>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </section>
  );
}
