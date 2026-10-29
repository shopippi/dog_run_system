import type { MeUnregistered } from '@dr/shared';
import { useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Progress } from '../../components/Progress';
import { Terms } from '../../components/Terms';
import { ActionBar } from '../../components/ActionBar';
import { BusyLabel } from '../../components/BusyLabel';

/** L-01 同意・はじめての方へ(C-01) */
export function ConsentStep({ me, onSubmit }: { me: MeUnregistered; onSubmit: () => Promise<void> }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <Progress step={1} />
      <div className="page-head">
        <h2>はじめての方へ</h2>
        <p className="lead">
          {me.lineDisplayName ? `${me.lineDisplayName}さん、` : ''}
          ようこそ。このLINEで、ドッグランの会員証(ポイントカード)が使えるようになります。
        </p>
      </div>
      <section className="section">
        <h3 className="section-label">できること</h3>
        <ul className="plain-list">
          <li>受付のQRコードを読み取るだけでチェックイン</li>
          <li>1日1ポイント。10ポイントで無料券1枚</li>
          <li>ご家族のLINEとポイントをいっしょにためられます</li>
        </ul>
      </section>
      <section className="section">
        <h3 className="section-label">お預かりする情報と使い道</h3>
        <p className="body-text">
          LINEの表示名、ワンちゃんの写真と情報、アンケートの回答、来場の記録をお預かりします。会員証とポイントの管理、受付でのお客さまの確認、ドッグランをよくするための集計に使います。
        </p>
        <Terms termsText={me.terms.termsText} privacyText={me.terms.privacyText} />
      </section>
      <label className="check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>利用規約とプライバシーポリシーに同意します</span>
      </label>
      {error ? <ErrorNotice error={error} /> : null}
      <ActionBar>
        <button type="button" className="btn" disabled={!agreed || busy} onClick={next}>
          <BusyLabel busy={busy} busyText="登録しています…">
            同意して次へ
          </BusyLabel>
        </button>
      </ActionBar>
    </main>
  );
}
