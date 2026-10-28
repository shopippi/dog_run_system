import type { HouseholdDetail, HouseholdFamilyMember, ReceptionInvite } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { adminApi, adminPost } from '../lib/api';
import { Dialog } from './Dialog';
import { ErrorNotice } from './ErrorNotice';
import { QrImage } from './QrImage';

/** 残り時間「9:58」 */
function useRemaining(expiresAt: string | null) {
  const calc = useCallback(() => (expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)) : 0), [expiresAt]);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    const t = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(t);
  }, [calc]);
  return left;
}

/**
 * 受付での家族の追加(A-06、5.2)。10分間だけ使える招待QRをタブレットに出し、家族に LINE のカメラで読み取ってもらう。
 */
export function FamilyInviteDialog({ d, onClose }: { d: HouseholdDetail; onClose: () => void }) {
  const [invite, setInvite] = useState<ReceptionInvite | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const left = useRemaining(invite?.expiresAt ?? null);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setInvite(await adminPost<ReceptionInvite>(`/households/${d.id}/invite-qr`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [d.id]);
  useEffect(() => {
    void create();
  }, [create]);

  const expired = invite !== null && left <= 0;
  const url = invite ? new URL(invite.url, location.origin).toString() : '';
  return (
    <Dialog
      title="家族を追加"
      onClose={onClose}
      footer={
        <>
          {expired && (
            <button type="button" className="btn sub" disabled={busy} onClick={() => void create()}>
              新しいQRコードを出す
            </button>
          )}
          <button type="button" className="btn" data-autofocus onClick={onClose}>
            閉じる
          </button>
        </>
      }
    >
      <p>
        追加する家族に、LINE のカメラでこの QR コードを読み取ってもらってください。参加すると、<b>{d.displayName}</b>
        の家族になり、同じ会員証でポイントがたまります。
      </p>
      {error ? <ErrorNotice error={error} /> : null}
      {invite && (
        <div className="fi-qr">
          {expired ? (
            <p className="fi-expired" role="status">
              QR コードの期限が切れました。「新しいQRコードを出す」を押してください。
            </p>
          ) : (
            <>
              <div className="fi-qr-frame">
                <QrImage value={url} size={220} label="家族の招待のQRコード" />
              </div>
              <p className="fi-left" role="timer" aria-live="off">
                あと <b className="mono">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b> 使えます(1回だけ)
              </p>
            </>
          )}
        </div>
      )}
      {!invite && !error && <p className="loading">QR コードを作っています…</p>}
    </Dialog>
  );
}

/** 家族を外す前の確認(A-06、5.4)。外したあとの結果を見せてから確定する */
export function RemoveFamilyDialog({
  d,
  m,
  onClose,
  onDone,
}: {
  d: HouseholdDetail;
  m: HouseholdFamilyMember;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const remain = d.family.filter((x) => x.status === 'active' && x.id !== m.id);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi(`/households/${d.id}/family/${m.id}`, { method: 'DELETE' });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const name = m.name ? `${m.name}さん` : 'この家族';
  return (
    <Dialog
      title="家族を外す"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy} onClick={submit}>
            {busy ? '外しています…' : '外す'}
          </button>
        </>
      }
    >
      <p>
        <b>{name}</b>を、{d.displayName}から外します。
      </p>
      <ul className="plain-list">
        <li>
          ポイント({d.balance}ポイント)・無料券({d.usableTickets}枚)・来場の記録は、おうちに残ります
        </li>
        <li>残る家族: {remain.map((x) => (x.name ? `${x.name}さん` : '名前なし')).join('、')}</li>
        <li>{name}の会員証は使えなくなります。新しいおうちとして登録し直せます</li>
        <li>間違えたときは、操作ログから元に戻せます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
