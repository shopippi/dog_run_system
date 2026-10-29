import { JOIN_METHOD_LABELS, type FamilyResponse } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { api, postJson } from '../../lib/api';
import { BottomSheet } from '../../components/BottomSheet';
import { BusyLabel } from '../../components/BusyLabel';
import { FamilyMembersSkeleton } from '../skeletons';

function formatDay(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/** L-11 家族の一覧と、自分がおうちから抜ける(C-13、5.4) */
export function FamilyMembers() {
  const [family, setFamily] = useState<FamilyResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api<FamilyResponse>('/api/family').then(setFamily).catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  if (loadError) return <ErrorNotice error={loadError} onRetry={load} />;
  if (!family) return <FamilyMembersSkeleton />;

  const alone = family.members.length <= 1;

  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson('/api/family/leave', {});
      // おうちから抜けたので、はじめから開き直す(未登録の人の画面になる)
      window.location.replace(import.meta.env.BASE_URL);
    } catch (e) {
      setError(e);
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <section className="section fam-section" aria-labelledby="fam-members">
        <h3 className="section-title" id="fam-members">
          いまの家族
        </h3>
        <ul className="rows fam-list">
          {family.members.map((m) => (
            <li key={m.id} className="fam-row">
              <b>
                {m.name ?? '家族'}
                {m.isMe && <span className="fam-me">(あなた)</span>}
              </b>
              <span className="sub-text">
                <span className="cu-nowrap">{formatDay(m.joinedAt)}に参加</span>
                <span className="cu-nowrap">・{JOIN_METHOD_LABELS[m.joinMethod]}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section fam-leave" aria-labelledby="fam-leave">
        <h3 className="section-label" id="fam-leave">
          このおうちから抜ける
        </h3>
        {alone ? (
          <p className="body-text">
            このおうちの家族はあなただけのため、抜けることはできません。退会したいときは、受付にお知らせください。
          </p>
        ) : (
          <>
            <p className="body-text">
              抜けても、ポイントと来場の記録はおうちに残ります。あなたのLINEではこの会員証を使えなくなり、使うときは新しいおうちとして登録し直します。
            </p>
            {error ? <ErrorNotice error={error} /> : null}
            <button type="button" className="btn sub danger" onClick={() => setConfirm(true)}>
              このおうちから抜ける
            </button>
            <BottomSheet
              open={confirm}
              onClose={() => setConfirm(false)}
              busy={busy}
              title="このおうちから抜けます"
              actions={
                <button type="button" className="btn danger-fill" disabled={busy} onClick={leave}>
                  <BusyLabel busy={busy} busyText="手続きしています…">
                    抜ける
                  </BusyLabel>
                </button>
              }
            >
              <p>ポイントと来場の記録はおうちに残ります。このLINEでは、この会員証を使えなくなります。</p>
            </BottomSheet>
          </>
        )}
      </section>
    </>
  );
}
